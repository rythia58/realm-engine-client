#include "pch-il2cpp.h"
#include "AutoAbility.h"
#include "AutoAim.h"
#include "Il2CppResolver.h"
#include "LocalPlayer.h"
#include "SharedMemory.h"
#include "DbgFileLog.h"

#include <atomic>
#include <cmath>
#include <windows.h>

namespace AutoAbility {
namespace {

std::atomic<bool>    g_enabled        { false };
std::atomic<float>   g_mpThresholdPct { 0.f };
std::atomic<int32_t> g_abilityItemType{ -1 };

constexpr ULONGLONG kMinFireIntervalMs = 250;
constexpr int32_t   kAbilitySlot       = 1;

// Trickster (804) and Kensei (818) are absent on purpose: their abilities move
// the player. The client also blocks any ability item with a teleport/dash
// activate (e.g. Rogue's Planewalker) before it reaches us.
enum class Behaviour { Unknown, TargetEnemy, SelfNoPos };

Behaviour BehaviourForClass(int32_t classType)
{
    switch (classType) {
    case 775: case 782: case 785: case 798: case 800: case 801:
    case 802: case 803: case 805: case 806: case 817:
        return Behaviour::TargetEnemy;
    case 768: case 784: case 796: case 797: case 799:
        return Behaviour::SelfNoPos;
    default:
        return Behaviour::Unknown;
    }
}

using UseInvByHotkeyFn = void(__fastcall*)(void* eqMgr, int32_t hotkey, void* methodInfo);

// Vector2 is passed by value in the IL2CPP x64 ABI.
struct Vec2 { float x; float y; };
using UseInvItemFn = bool(__fastcall*)(
    void* eqMgr, void* owner, int32_t slot, int32_t itemType,
    Vec2 pos, bool a, bool b, void* methodInfo);

UseInvByHotkeyFn s_fnHotkey      = nullptr;
UseInvItemFn     s_fnTargeted    = nullptr;
uint32_t         s_eqMgrFieldOff = 0;
bool             s_resolved      = false;
ULONGLONG        s_lastFireMs    = 0;
bool             s_consuming     = false;

void ResolveOnce()
{
    if (s_resolved) return;
    Resolver::Protection::safe_call([&]() {
        Il2CppClass* em = Resolver::FindClass("DecaGames.RotMG.Managers.Equipment", "EquipmentManager");
        if (!em) em = Resolver::FindClassLoose("PNBNDBIPENP");
        if (em) {
            const MethodInfo* miHk = il2cpp_class_get_method_from_name(em, "UseInventoryItemByHotkey", 1);
            if (miHk && miHk->methodPointer)
                s_fnHotkey = reinterpret_cast<UseInvByHotkeyFn>(miHk->methodPointer);
            const MethodInfo* miUse = il2cpp_class_get_method_from_name(em, "UseInventoryItem", 6);
            if (miUse && miUse->methodPointer)
                s_fnTargeted = reinterpret_cast<UseInvItemFn>(miUse->methodPointer);
        }
        Il2CppClass* fk = Resolver::FindClassLoose("FKALGHJIADI");
        if (fk) {
            FieldInfo* eqf = il2cpp_class_get_field_from_name(fk, "AJJJBDBNBLM");
            if (eqf) s_eqMgrFieldOff = static_cast<uint32_t>(il2cpp_field_get_offset(eqf));
        }
    });
    if (s_fnHotkey && s_eqMgrFieldOff) s_resolved = true;
}

void* ReadEquipmentManager(void* lp)
{
    void* eqMgr = nullptr;
    __try {
        eqMgr = *reinterpret_cast<void**>(reinterpret_cast<uint8_t*>(lp) + s_eqMgrFieldOff);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        eqMgr = nullptr;
    }
    return eqMgr;
}

} // namespace

bool IsEnabled() { return g_enabled.load(std::memory_order_relaxed); }

// Throttled bail-reason diagnostic (once/sec). Remove once verified in-game.
static void DiagBail(const char* why)
{
    static ULONGLONG s_lastDiagMs = 0;
    const ULONGLONG now = GetTickCount64();
    if (now - s_lastDiagMs < 1000) return;
    s_lastDiagMs = now;
    DBG_FILE_LOG("[AutoAbility] bail: " << why);
}

void Tick()
{
    if (!IsEnabled()) return;
    ResolveOnce();
    if (!s_resolved) { DiagBail("not resolved (eqMgr/hotkey fn)"); return; }

    const ULONGLONG now = GetTickCount64();
    if (now - s_lastFireMs < kMinFireIntervalMs) return;

    const float   curMp = LocalPlayer::GetCurMpF();
    const int32_t maxMp = LocalPlayer::GetMaxMP();
    if (maxMp <= 0 || curMp <= 0.f) { DiagBail("mp read invalid (maxMp/curMp)"); return; }
    const float pct = curMp / static_cast<float>(maxMp) * 100.f;
    if (pct < g_mpThresholdPct.load(std::memory_order_relaxed)) { DiagBail("mp below floor"); return; }

    void* lp = LocalPlayer::GetPtr();
    if (!lp) { DiagBail("no local player ptr"); return; }
    void* eqMgr = ReadEquipmentManager(lp);
    if (!eqMgr) { DiagBail("eqMgr ptr null"); return; }

    const int32_t cls = SharedMemory::GetClientClassType();
    const Behaviour beh = BehaviourForClass(cls);
    if (beh == Behaviour::Unknown) { DiagBail("class unknown"); return; }

    const int32_t itemType = g_abilityItemType.load(std::memory_order_relaxed);
    bool fired = false;

    switch (beh) {
    case Behaviour::TargetEnemy: {
        if (!AutoAim::IsEnabled() || !AutoAim::HasTarget()) { DiagBail("target class: no autoaim target"); return; }
        float ax = 0.f, ay = 0.f;
        AutoAim::GetAimTarget(ax, ay);
        if (!std::isfinite(ax) || !std::isfinite(ay) || (ax == 0.f && ay == 0.f)) { DiagBail("target class: bad aim coords"); return; }
        if (!s_fnTargeted || itemType <= 0) { DiagBail("target class: no targeted fn or itemType<=0"); return; }
        Resolver::Protection::safe_call([&]() {
            s_fnTargeted(eqMgr, lp, kAbilitySlot, itemType, Vec2{ ax, ay }, false, false, nullptr);
        });
        fired = true;
        break;
    }
    case Behaviour::SelfNoPos: {
        // Proven path (same as autopot): the game activates the ability at its
        // own aim; no owner/position args to get wrong.
        Resolver::Protection::safe_call([&]() {
            s_fnHotkey(eqMgr, kAbilitySlot, nullptr);
        });
        fired = true;
        break;
    }
    default:
        break;
    }

    if (fired) {
        s_lastFireMs = now;
        DBG_FILE_LOG("[AutoAbility] FIRED cls=" << cls << " item=" << itemType
            << " beh=" << (beh == Behaviour::TargetEnemy ? "target" : "self"));
    }
}

void SetEnabled(bool on)
{
    const bool was = g_enabled.exchange(on, std::memory_order_relaxed);
    if (on == was) return;
    if (on) {
        if (!s_consuming) { LocalPlayer::AddConsumer(); s_consuming = true; }
        ResolveOnce();
    } else if (s_consuming) {
        LocalPlayer::RemoveConsumer();
        s_consuming = false;
    }
}

void SetMpThresholdPct(float pct)
{
    if (!(pct >= 0.f)) pct = 0.f;
    if (pct > 100.f)   pct = 100.f;
    g_mpThresholdPct.store(pct, std::memory_order_relaxed);
}

void    SetAbilityItemType(int32_t itemType) { g_abilityItemType.store(itemType, std::memory_order_relaxed); }
int32_t GetAbilityItemType()                 { return g_abilityItemType.load(std::memory_order_relaxed); }

} // namespace AutoAbility
