#pragma once
// Internal feature-state interface.
// Shared between FeatureState.cpp (owners of the atomics) and IpcBridge.cpp
// (DispatchCommand needs direct writes to individual atomics without setter overhead).
// Not part of the public IPC API — callers outside the IPC system use IpcBridge.h.

#include <atomic>
#include <cstdint>

// ── Bridge-thread service calls implemented in FeatureState.cpp ──────────────
// Called from IpcBridgeThread to observe keyboard events managed by feature state.
bool IpcBridge_PollSocketHotkeyEvent();

// Returns -1 if no noclip state change is pending; else 0 or 1 (the new enabled
// value). Atomically clears the pending flag on read.
int IpcBridge_DrainPendingNoclipEnabled();

// ── Feature state atomics (defined in FeatureState.cpp) ──────────────────────
// DispatchCommand in IpcBridge.cpp writes these directly for zero-overhead updates.
// All reads by the render thread go through the IpcBridge_Get* / Apply* API.
extern std::atomic<bool>    s_overlayEnabled;
extern std::atomic<int>     s_featAutoAimEnabled;
extern std::atomic<int>     s_featAutoAimMode;
extern std::atomic<int>     s_featProjectileNoclipEnabled;
extern std::atomic<int32_t> s_featClientDefense;
extern std::atomic<int32_t> s_featClientClassType;
extern std::atomic<int>     s_featDodgeMode;
extern std::atomic<float>   s_featDodgeHorizonMs;
extern std::atomic<float>   s_featDodgeHitboxPadding;
extern std::atomic<int>     s_featDodgeWallAvoid;
extern std::atomic<int>     s_featAutoAbilityEnabled;
extern std::atomic<float>   s_featAutoAbilityMpPct;
extern std::atomic<int>     s_featAutoAbilityWizardMode;
extern std::atomic<int>     s_featPlayerNoclipActive;
extern std::atomic<int>     s_featPlayerNoclipEnabled;
extern std::atomic<int>     s_featPlayerNoclipHotkeyVk;
extern std::atomic<int>     s_featSocketHotkeyActive;
extern std::atomic<int>     s_featSocketHotkeyVk;
extern std::atomic<int>     s_featWalkTargetActive;
extern std::atomic<float>   s_featWalkTargetX;
extern std::atomic<float>   s_featWalkTargetY;
extern std::atomic<int>     s_featCameraZoomActive;
extern std::atomic<float>   s_featCameraZoomValue;
extern std::atomic<int>     s_featCameraAngleActive;
extern std::atomic<int>     s_featCameraAngleValue;
extern std::atomic<int>     s_featCameraCenteringActive;
extern std::atomic<int>     s_featCameraCentered;
extern std::atomic<int>     s_featSkinOverrideEnabled;
extern std::atomic<int>     s_featSkinOverrideId;
extern std::atomic<int>     s_featO3ShieldActive;
