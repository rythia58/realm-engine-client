#include "pch-il2cpp.h"
#include "IpcBridge.h"
#include "FeatureState.h"
#include "DbgFileLog.h"
#include "GameState.h"
#include "AutoAim.h"
#include "ProjNoclip.h"
#include "DangerPlanner.h"
#include "Noclip.h"
#include "SkinChanger.h"
#include "gui/tabs/TestTAB.h"
#include "gui/tabs/CameraTAB.h"
#include "gui/tabs/CombatTab/CombatTAB.h"

#include <climits>
#include <limits>
#include <atomic>
#include <cstdint>

// ── Overlay enable flag ───────────────────────────────────────────────────────

std::atomic<bool> s_overlayEnabled{false};

bool IpcBridge_IsOverlayEnabled() { return s_overlayEnabled.load(std::memory_order_relaxed); }

// ── Unified feature overrides (setFeature over authenticated pipe) ────────────

std::atomic<int>     s_featAutoAimEnabled{0};
std::atomic<int>     s_featAutoAimMode{0};
std::atomic<int>     s_featProjectileNoclipEnabled{0};
std::atomic<int32_t> s_featClientDefense{static_cast<int32_t>(0x80000000u)};
std::atomic<int32_t> s_featClientClassType{0};
std::atomic<int>     s_featDodgeMode{0};
std::atomic<float>   s_featDodgeHorizonMs{800.f};
std::atomic<float>   s_featDodgeHitboxPadding{0.f};
std::atomic<int>     s_featDodgeWallAvoid{1};
std::atomic<int>     s_featAutoAbilityEnabled{0};
std::atomic<float>   s_featAutoAbilityMpPct{0.f};
std::atomic<int>     s_featAutoAbilityWizardMode{0};
std::atomic<int>     s_featPlayerNoclipActive{0};
std::atomic<int>     s_featPlayerNoclipEnabled{0};
std::atomic<int>     s_featPlayerNoclipHotkeyVk{'N'};
static std::atomic<int> s_pendingPlayerNoclipEnabled{-1};
std::atomic<int>     s_featSocketHotkeyActive{0};
std::atomic<int>     s_featSocketHotkeyVk{'L'};
std::atomic<int>     s_featWalkTargetActive{0};
std::atomic<float>   s_featWalkTargetX{0.f};
std::atomic<float>   s_featWalkTargetY{0.f};
std::atomic<int>     s_featCameraZoomActive{0};
std::atomic<float>   s_featCameraZoomValue{8.f};
std::atomic<int>     s_featCameraAngleActive{0};
std::atomic<int>     s_featCameraAngleValue{0};
std::atomic<int>     s_featCameraCenteringActive{0};
std::atomic<int>     s_featCameraCentered{1};
std::atomic<int>     s_featSkinOverrideEnabled{0};
std::atomic<int>     s_featSkinOverrideId{0};
std::atomic<int>     s_featO3ShieldActive{0};

// ── Internal helpers ──────────────────────────────────────────────────────────

namespace {

static bool IsCurrentProcessForeground()
{
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    return pid == GetCurrentProcessId();
}

// ── Apply* functions — run every frame from dPresent ─────────────────────────
// Each tracks its last-applied value and only fires setters on change to avoid
// hammering IL2CPP setters (e.g. repeatedly writing orthographicSize broke
// world rendering).

void ApplyAutoAimFeatureState()
{
    static int s_lastEnabled = -1;
    static int s_lastMode    = -1;

    const int enabled = s_featAutoAimEnabled.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    if (enabled != s_lastEnabled) {
        s_lastEnabled = enabled;
        AutoAim::SetEnabled(enabled != 0);
    }

    const int aimMode = s_featAutoAimMode.load(std::memory_order_relaxed);
    if (aimMode != s_lastMode) {
        s_lastMode = aimMode;
        AutoAim::AimMode resolved = AutoAim::AimMode::ClosestToPlayer;
        if (aimMode == 1)      resolved = AutoAim::AimMode::HighestHP;
        else if (aimMode == 2) resolved = AutoAim::AimMode::ClosestToMouse;
        AutoAim::SetAimMode(resolved);
    }
}

void ApplyProjectileNoclipFeatureState()
{
    static int s_lastEnabled = -1;

    const int enabled = s_featProjectileNoclipEnabled.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    if (enabled != 0 && !ProjNoclip::IsInstalled()) {
        ProjNoclip::Install();
    }

    if (enabled != s_lastEnabled || ProjNoclip::IsEnabled() != (enabled != 0)) {
        s_lastEnabled = enabled;
        ProjNoclip::SetEnabled(enabled != 0);
    }
}

void ApplyAutoDodgeFeatureState()
{
    // After the Offsets merge, A* is the only dodge mode. The legacy
    // VO/BFS/MPC/Flow-specific settings (horizonMs, hitboxPadding, wallAvoid)
    // are kept in the pipe protocol for dashboard state-sync but have no
    // DLL-side consumer — the atomics are stored in TestTAB via the existing
    // setters (no-op writes that preserve the UI round trip).
    static int   s_lastMode      = INT32_MIN;
    static float s_lastHorizonMs = -1.f;

    int dodgeMode = s_featDodgeMode.load(std::memory_order_relaxed);
    if (dodgeMode < 0) dodgeMode = 0;
    if (dodgeMode > static_cast<int>(TestTAB::DodgeMode::Rollout))
        dodgeMode = static_cast<int>(TestTAB::DodgeMode::Rollout);
    if (dodgeMode != s_lastMode) {
        s_lastMode = dodgeMode;
        TestTAB::SetDodgeModeWithEnter(static_cast<TestTAB::DodgeMode>(dodgeMode));
    }

    // Belt-and-suspenders: keep retrying the AppEngineManager::Update hook
    // install every IPC tick while dodge is on. TestTAB::Tick also retries it,
    // but that path is gated behind localPlayer resolution which can fail on
    // updated game builds. This path has no such gate. TryInstall() is
    // idempotent — instant no-op once the hook is installed.
    if (dodgeMode != static_cast<int>(TestTAB::DodgeMode::Off)) {
        DangerPlanner::TryInstall();
    }

    float horizonMs = s_featDodgeHorizonMs.load(std::memory_order_relaxed);
    if (horizonMs < 100.f) horizonMs = 100.f;
    if (horizonMs > 4000.f) horizonMs = 4000.f;
    if (horizonMs != s_lastHorizonMs) {
        s_lastHorizonMs = horizonMs;
        TestTAB::SetDodgeLookaheadMs(horizonMs);
    }
}

void ApplyAutoAbilityFeatureState()
{
    static int   s_lastEnabled = -1;
    static float s_lastMpPct   = -1.f;
    static int   s_lastWizMode = INT32_MIN;

    const int enabled = s_featAutoAbilityEnabled.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    if (enabled != s_lastEnabled) {
        s_lastEnabled = enabled;
        CombatTAB::SetAutoAbility(enabled != 0);
    }

    const float mpPct = s_featAutoAbilityMpPct.load(std::memory_order_relaxed);
    if (mpPct != s_lastMpPct) {
        s_lastMpPct = mpPct;
        CombatTAB::SetAbilityMpPct(mpPct);
    }

    const int wizMode = s_featAutoAbilityWizardMode.load(std::memory_order_relaxed);
    if (wizMode != s_lastWizMode) {
        s_lastWizMode = wizMode;
        CombatTAB::SetWizardAbilityTargetMode(wizMode);
    }
}

void ApplyPlayerNoclipFeatureState()
{
    static int  s_lastEnabled    = -1;
    static bool s_lastHotkeyDown = false;

    const int active  = s_featPlayerNoclipActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    int enabled = active && s_featPlayerNoclipEnabled.load(std::memory_order_relaxed) != 0 ? 1 : 0;

    const int vk = s_featPlayerNoclipHotkeyVk.load(std::memory_order_relaxed);
    const bool hotkeyDown = active && vk != 0 && IsCurrentProcessForeground() &&
        ((GetAsyncKeyState(vk) & 0x8000) != 0);
    if (hotkeyDown && !s_lastHotkeyDown) {
        enabled = enabled ? 0 : 1;
        s_featPlayerNoclipEnabled.store(enabled, std::memory_order_relaxed);
        s_pendingPlayerNoclipEnabled.store(enabled, std::memory_order_relaxed);
    }
    s_lastHotkeyDown = hotkeyDown;

    if (enabled != s_lastEnabled) {
        s_lastEnabled = enabled;
        Noclip::SetEnabled(enabled != 0);
        Noclip::SetMode(enabled != 0 ? 1 : 0);
    }
}

void ApplyWalkTargetFeatureState()
{
    static int   s_lastActive = -1;
    static float s_lastX      = std::numeric_limits<float>::quiet_NaN();
    static float s_lastY      = std::numeric_limits<float>::quiet_NaN();

    const int   walkActive = s_featWalkTargetActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    const float walkX      = s_featWalkTargetX.load(std::memory_order_relaxed);
    const float walkY      = s_featWalkTargetY.load(std::memory_order_relaxed);

    const bool changed = walkActive != s_lastActive
        || walkX != s_lastX  // NaN != NaN → first call always fires
        || walkY != s_lastY;
    if (changed) {
        s_lastActive = walkActive;
        s_lastX      = walkX;
        s_lastY      = walkY;
        TestTAB::SetBotWalkTarget(walkX, walkY, walkActive != 0);
    }
}

void ApplyCameraFeatureState()
{
    static int   s_lastZoomActive     = -1;
    static float s_lastZoomValue      = std::numeric_limits<float>::quiet_NaN();
    static int   s_lastAngleActive    = -1;
    static int   s_lastAngleValue     = INT32_MIN;
    static int   s_lastCenterActive   = -1;
    static int   s_lastCenteredPlayer = -1;

    const int   zoomActive = s_featCameraZoomActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    const float zoomValue  = s_featCameraZoomValue.load(std::memory_order_relaxed);
    if (zoomActive != 0 && (zoomActive != s_lastZoomActive || zoomValue != s_lastZoomValue)) {
        DBG_FILE_LOG("[ApplyCamera] zoom apply — active=" << zoomActive
            << " lastActive=" << s_lastZoomActive
            << " value=" << zoomValue
            << " lastValue=" << s_lastZoomValue);
        s_lastZoomActive = zoomActive;
        s_lastZoomValue  = zoomValue;
        CameraTAB::SetZoomValue(zoomValue);
    } else if (zoomActive == 0) {
        if (s_lastZoomActive != zoomActive)
            DBG_FILE_LOG("[ApplyCamera] zoom disable (lastActive=" << s_lastZoomActive << ")");
        s_lastZoomActive = zoomActive;
    }

    const int angleActive = s_featCameraAngleActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    const int angleValue  = s_featCameraAngleValue.load(std::memory_order_relaxed);
    if (angleActive != 0 && (angleActive != s_lastAngleActive || angleValue != s_lastAngleValue)) {
        s_lastAngleActive = angleActive;
        s_lastAngleValue  = angleValue;
        CameraTAB::SetAngleDegrees(angleValue);
    } else if (angleActive == 0) {
        s_lastAngleActive = angleActive;
    }

    const int centerActive   = s_featCameraCenteringActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    const int centeredPlayer = s_featCameraCentered.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    if (centerActive != 0 && (centerActive != s_lastCenterActive || centeredPlayer != s_lastCenteredPlayer)) {
        s_lastCenterActive   = centerActive;
        s_lastCenteredPlayer = centeredPlayer;
        CameraTAB::SetCenteredOnPlayer(centeredPlayer != 0);
    } else if (centerActive == 0) {
        s_lastCenterActive = centerActive;
    }
}

} // namespace

// ── Public getters ────────────────────────────────────────────────────────────

bool    IpcBridge_GetAutoAimEnabled()   { return s_featAutoAimEnabled.load(std::memory_order_relaxed) != 0; }
int     IpcBridge_GetAutoAimMode()      { return s_featAutoAimMode.load(std::memory_order_relaxed); }
int     IpcBridge_GetAutoDodgeMode()    { return s_featDodgeMode.load(std::memory_order_relaxed); }
float   IpcBridge_GetAutoDodgeHorizonMs()    { return s_featDodgeHorizonMs.load(std::memory_order_relaxed); }
float   IpcBridge_GetAutoDodgeHitboxPadding(){ return s_featDodgeHitboxPadding.load(std::memory_order_relaxed); }
bool    IpcBridge_GetAutoDodgeWallAvoid()    { return s_featDodgeWallAvoid.load(std::memory_order_relaxed) != 0; }
bool    IpcBridge_GetAutoAbilityEnabled()    { return s_featAutoAbilityEnabled.load(std::memory_order_relaxed) != 0; }
float   IpcBridge_GetAutoAbilityMpPct()      { return s_featAutoAbilityMpPct.load(std::memory_order_relaxed); }
int     IpcBridge_GetAutoAbilityWizardMode() { return s_featAutoAbilityWizardMode.load(std::memory_order_relaxed); }
float   IpcBridge_GetWalkTargetX()      { return s_featWalkTargetX.load(std::memory_order_relaxed); }
float   IpcBridge_GetWalkTargetY()      { return s_featWalkTargetY.load(std::memory_order_relaxed); }
bool    IpcBridge_GetWalkTargetActive() { return s_featWalkTargetActive.load(std::memory_order_relaxed) != 0; }
bool    IpcBridge_GetCameraZoomActive() { return s_featCameraZoomActive.load(std::memory_order_relaxed) != 0; }
float   IpcBridge_GetCameraZoomValue()  { return s_featCameraZoomValue.load(std::memory_order_relaxed); }
bool    IpcBridge_GetCameraAngleActive(){ return s_featCameraAngleActive.load(std::memory_order_relaxed) != 0; }
int     IpcBridge_GetCameraAngleValue() { return s_featCameraAngleValue.load(std::memory_order_relaxed); }
bool    IpcBridge_GetCameraCenteringActive(){ return s_featCameraCenteringActive.load(std::memory_order_relaxed) != 0; }
bool    IpcBridge_GetCameraCentered()   { return s_featCameraCentered.load(std::memory_order_relaxed) != 0; }
bool    IpcBridge_GetSkinOverrideEnabled(){ return s_featSkinOverrideEnabled.load(std::memory_order_relaxed) != 0; }
int     IpcBridge_GetSkinOverrideId()   { return s_featSkinOverrideId.load(std::memory_order_relaxed); }
int32_t IpcBridge_GetClientDefense()    { return s_featClientDefense.load(std::memory_order_relaxed); }
int32_t IpcBridge_GetClientClassType()  { return s_featClientClassType.load(std::memory_order_relaxed); }
bool    IpcBridge_GetO3ShieldActive()   { return s_featO3ShieldActive.load(std::memory_order_relaxed) != 0; }

// ── Public setters ────────────────────────────────────────────────────────────

void IpcBridge_SetAutoAimEnabled(bool enabled)
{
    s_featAutoAimEnabled.store(enabled ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetAutoAimMode(int mode)
{
    if (mode < 0) mode = 0;
    if (mode > 2) mode = 2;
    s_featAutoAimMode.store(mode, std::memory_order_relaxed);
}

void IpcBridge_SetAutoDodgeMode(int mode)
{
    if (mode < 0) mode = 0;
    if (mode > static_cast<int>(TestTAB::DodgeMode::Rollout))
        mode = static_cast<int>(TestTAB::DodgeMode::Rollout);
    s_featDodgeMode.store(mode, std::memory_order_relaxed);
}

void IpcBridge_SetAutoDodgeHorizonMs(float ms)
{
    if (ms < 100.f) ms = 100.f;
    if (ms > 4000.f) ms = 4000.f;
    s_featDodgeHorizonMs.store(ms, std::memory_order_relaxed);
}

void IpcBridge_SetAutoDodgeHitboxPadding(float paddingTiles)
{
    if (paddingTiles < 0.f) paddingTiles = 0.f;
    if (paddingTiles > 1.5f) paddingTiles = 1.5f;
    s_featDodgeHitboxPadding.store(paddingTiles, std::memory_order_relaxed);
}

void IpcBridge_SetAutoDodgeWallAvoid(bool enabled)
{
    s_featDodgeWallAvoid.store(enabled ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetAutoAbilityEnabled(bool enabled)
{
    s_featAutoAbilityEnabled.store(enabled ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetAutoAbilityMpPct(float pctZeroTo100)
{
    if (pctZeroTo100 < 0.f) pctZeroTo100 = 0.f;
    if (pctZeroTo100 > 100.f) pctZeroTo100 = 100.f;
    s_featAutoAbilityMpPct.store(pctZeroTo100, std::memory_order_relaxed);
}

void IpcBridge_SetAutoAbilityWizardMode(int mode)
{
    s_featAutoAbilityWizardMode.store(mode == 1 ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetWalkTarget(float worldX, float worldY, bool active)
{
    s_featWalkTargetX.store(worldX, std::memory_order_relaxed);
    s_featWalkTargetY.store(worldY, std::memory_order_relaxed);
    s_featWalkTargetActive.store(active ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetCameraZoom(bool active, float zoom)
{
    s_featCameraZoomActive.store(active ? 1 : 0, std::memory_order_relaxed);
    s_featCameraZoomValue.store(zoom, std::memory_order_relaxed);
}

void IpcBridge_SetCameraAngle(bool active, int angle)
{
    s_featCameraAngleActive.store(active ? 1 : 0, std::memory_order_relaxed);
    s_featCameraAngleValue.store(angle, std::memory_order_relaxed);
}

void IpcBridge_SetCameraCentering(bool active, bool centered)
{
    s_featCameraCenteringActive.store(active ? 1 : 0, std::memory_order_relaxed);
    s_featCameraCentered.store(centered ? 1 : 0, std::memory_order_relaxed);
}

void IpcBridge_SetSkinOverride(bool enabled, int skinId)
{
    s_featSkinOverrideEnabled.store(enabled ? 1 : 0, std::memory_order_relaxed);
    s_featSkinOverrideId.store(skinId, std::memory_order_relaxed);
    SkinChanger::SetOverride(enabled, skinId);
}

// ── Frame-tick: apply queued feature state to the game ───────────────────────

void IpcBridge_ApplyFeatureOverrides()
{
    // Player noclip is pure feature state plus keyboard polling. Apply it even
    // while changing realms so a client-side OFF reaches Noclip immediately.
    ApplyPlayerNoclipFeatureState();

    // Gate on game world readiness: local player + world manager must exist before
    // calling into game code. GetLocalPtr() is null in loading screens / between
    // realms and calling IL2CPP setters with null game state will crash the game.
    if (GameState::GetLocalPtr() == nullptr) return;
    if (GameState::GetWorldMgr() == nullptr) return;

    ApplyAutoAimFeatureState();
    ApplyProjectileNoclipFeatureState();
    ApplyAutoDodgeFeatureState();
    ApplyAutoAbilityFeatureState();
    ApplyWalkTargetFeatureState();
    ApplyCameraFeatureState();
}

// ── Bridge-thread service calls ───────────────────────────────────────────────

bool IpcBridge_PollSocketHotkeyEvent()
{
    static bool s_lastHotkeyDown = false;

    const int  active      = s_featSocketHotkeyActive.load(std::memory_order_relaxed) != 0 ? 1 : 0;
    const int  vk          = s_featSocketHotkeyVk.load(std::memory_order_relaxed);
    const bool hotkeyDown  = active && vk != 0 && IsCurrentProcessForeground() &&
        ((GetAsyncKeyState(vk) & 0x8000) != 0);

    const bool shouldFire = hotkeyDown && !s_lastHotkeyDown;
    s_lastHotkeyDown = hotkeyDown;
    return shouldFire;
}

int IpcBridge_DrainPendingNoclipEnabled()
{
    return s_pendingPlayerNoclipEnabled.exchange(-1, std::memory_order_relaxed);
}
