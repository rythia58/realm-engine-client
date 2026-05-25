#include "pch-il2cpp.h"
#include "BagLooter.h"
// AutoDrink was trimmed in production cleanup; the per-arrival drink
// pass below is now a no-op (kept the comment as a marker for the
// follow-up phase if we re-introduce stat-pot drinking).
#include "DangerPlanner.h"
#include "LocalPlayer.h"
#include "DbgFileLog.h"
#include "Il2CppResolver.h"
#include "minhook/MinHook.h"
#include "gui/tabs/WorldTAB.h"

#include <atomic>
#include <cmath>
#include <Windows.h>

namespace {

// Loot-bag object types from the game's Objects.xml (Multitool reference).
// Boost variants of each tier sit alongside the canonical type so an
// enabled tier picks up both. Phase-1 scope: detect, route to. Drinking
// / picking up is phase 2/3.
struct BagTypeEntry {
    int32_t            type;
    BagLooter::BagTier tier;
};
constexpr BagTypeEntry kBagTypes[] = {
    // Brown
    { 0x0500, BagLooter::Brown     },
    { 0x06ad, BagLooter::Brown     },   // Loot Bag 0 Boost
    // Pink
    { 0x0506, BagLooter::Pink      },
    { 0x06ae, BagLooter::Pink      },   // Loot Bag 1 Boost
    // Purple
    { 0x0507, BagLooter::Purple    },
    { 0x06ba, BagLooter::Purple    },   // Loot Bag 2 Boost
    // Cyan
    { 0x0508, BagLooter::Cyan      },
    { 0x06bb, BagLooter::Cyan      },   // Loot Bag 3 Boost
    // Blue
    { 0x0509, BagLooter::Blue      },
    { 0x06bd, BagLooter::Blue      },   // Loot Bag 4 Boost
    // White (UT-tier — community calls Loot Bag 5 Boost the "white bag").
    { 0x06be, BagLooter::White     },   // Loot Bag 5 Boost
    { 0x0510, BagLooter::White     },   // Loot Bag 6 Boost (Eternal-tier, treat as white)
    { 0x06bc, BagLooter::White     },   // Loot Bag 7 Boost
    { 0x050f, BagLooter::White     },   // Loot Bag 8 (rare event drop)
    { 0x06bf, BagLooter::White     },   // Loot Bag 8 Boost
    { 0x06ac, BagLooter::White     },   // Loot Bag 9
    { 0x06c0, BagLooter::White     },   // Loot Bag 9 Boost
    // Soulbound
    { 0x0503, BagLooter::Soulbound },
};

constexpr int kBagTypeCount = sizeof(kBagTypes) / sizeof(kBagTypes[0]);

std::atomic<bool>  s_enabled       { false };
std::atomic<bool>  s_tierEnabled[BagLooter::TierCount_] = {
    {false}, {false}, {false}, {true},   // Cyan default on
    {true},  {true},  {true}              // Blue, White, Soulbound default on
};
std::atomic<float> s_maxWalkDist   { 12.f };
std::atomic<bool>  s_autoLoot      { false };
std::atomic<bool>  s_autoPickup    { false };
std::atomic<ULONGLONG> s_lastLootAttemptMs { 0 };
constexpr ULONGLONG kLootAttemptCooldownMs = 350ULL;

std::atomic<int32_t> s_activeBagId      { 0 };
std::atomic<float>   s_activeBagDist    { 0.f };
std::atomic<const char*> s_statusTag    { "off" };

// ── Auto-loot: capture LootBagPanel via __ctor hook ──────────────────────
// The game constructs a LootBagPanel when the player first walks onto a
// bag. We hook the constructor to capture `__this` — the captured pointer
// stays valid until the panel is destroyed (when the player walks off the
// bag). The struct layout (verified from il2cpp-types.h):
//   LootBagPanel.fields.items          InteractiveItemSlot__Array*
//   LootBagPanel.fields.AJJJBDBNBLM    EquipmentManager*
//   LootBagPanel.fields.DOCGOOALILC    LKHPPBEGNOM* (the player)
//
// The autoloot tick reads the items array and calls
// EquipmentManager_InventorySwap on each non-null slot, transferring it
// into the player's inventory.

using CtorFn  = void(__fastcall*)(void* __this, void* methodInfo);
using SwapFn  = void(__fastcall*)(void* eqMgr, void* itemSlot, void* methodInfo);

CtorFn  s_origCtor          = nullptr;
SwapFn  s_fnInventorySwap   = nullptr;
void*   s_lastBagPanel      = nullptr;          // captured singleton (lifetime = panel's)
uint32_t s_panelItemsOff    = 0;                // LootBagPanel.items offset
uint32_t s_panelEqMgrOff    = 0;                // LootBagPanel.AJJJBDBNBLM offset
bool    s_autolootResolved  = false;
bool    s_ctorHookInstalled = false;

void __fastcall HookedCtor(void* __this, void* methodInfo)
{
    if (s_origCtor) s_origCtor(__this, methodInfo);
    s_lastBagPanel = __this;
}

void ResolveAutolootOnce()
{
    if (s_autolootResolved) return;
    Resolver::Protection::safe_call([&]() {
        // EquipmentManager.InventorySwap (1 arg: InteractiveItemSlot*)
        Il2CppClass* em = Resolver::FindClass("DecaGames.RotMG.Managers.Equipment", "EquipmentManager");
        if (!em) em = Resolver::FindClassLoose("PNBNDBIPENP");
        if (em) {
            const MethodInfo* mi = il2cpp_class_get_method_from_name(em, "InventorySwap", 1);
            if (mi && mi->methodPointer)
                s_fnInventorySwap = reinterpret_cast<SwapFn>(mi->methodPointer);
        }

        // LootBagPanel field offsets — items array + EquipmentManager ptr
        Il2CppClass* lbp = Resolver::FindClass("DecaGames.RotMG.UI.Panels", "LootBagPanel");
        if (!lbp) lbp = Resolver::FindClassLoose("LootBagPanel");
        if (lbp) {
            FieldInfo* fItems = il2cpp_class_get_field_from_name(lbp, "items");
            if (fItems) s_panelItemsOff = static_cast<uint32_t>(il2cpp_field_get_offset(fItems));
            FieldInfo* fEqMgr = il2cpp_class_get_field_from_name(lbp, "AJJJBDBNBLM");
            if (fEqMgr) s_panelEqMgrOff = static_cast<uint32_t>(il2cpp_field_get_offset(fEqMgr));

            // Hook the constructor so we capture the panel singleton.
            if (!s_ctorHookInstalled) {
                const MethodInfo* ctor = il2cpp_class_get_method_from_name(lbp, ".ctor", 0);
                if (ctor && ctor->methodPointer) {
                    void* target = reinterpret_cast<void*>(ctor->methodPointer);
                    if (MH_CreateHook(target, reinterpret_cast<void*>(&HookedCtor),
                                       reinterpret_cast<void**>(&s_origCtor)) == MH_OK
                        && MH_EnableHook(target) == MH_OK) {
                        s_ctorHookInstalled = true;
                    }
                }
            }
        }
    });
    if (s_fnInventorySwap && s_panelItemsOff && s_panelEqMgrOff) {
        s_autolootResolved = true;
    }
}

// Mirrors InteractiveItemSlot__Array layout. We only need to walk the
// vector portion — Il2Cpp arrays put the element pointers immediately
// after `bounds + max_length`.
struct InteractiveItemSlotArrayLite {
    void* klass;
    void* monitor;
    void* bounds;
    uint64_t max_length;
    void* vector[32];   // covers the max bag-slot count (8 is typical)
};

// SEH-protected reads of the panel pointers. Isolated from
// ApplyLootAtBag because that function has DBG_FILE_LOG (a C++
// ostringstream) which can't coexist with __try in MSVC.
static bool SehReadPanelPtrs(void* panel,
                             InteractiveItemSlotArrayLite** outArr,
                             void** outEqMgr)
{
    if (!panel) return false;
    __try {
        *outArr = *reinterpret_cast<InteractiveItemSlotArrayLite**>(
                    reinterpret_cast<uint8_t*>(panel) + s_panelItemsOff);
        *outEqMgr = *reinterpret_cast<void**>(
                    reinterpret_cast<uint8_t*>(panel) + s_panelEqMgrOff);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    return true;
}

void ApplyLootAtBag(int32_t bagObjectId)
{
    ResolveAutolootOnce();
    if (!s_autolootResolved || !s_lastBagPanel) {
        // Captured panel not yet resolved (panel never opened this session?).
        // Heartbeat log so the dev can tell autoloot is on but waiting.
        static ULONGLONG s_lastNoBagLogMs = 0;
        const ULONGLONG nowMs = GetTickCount64();
        if (nowMs - s_lastNoBagLogMs >= 5000) {
            s_lastNoBagLogMs = nowMs;
            DBG_FILE_LOG("[looter] ApplyLootAtBag bag=" << bagObjectId
                         << " — waiting for LootBagPanel singleton capture"
                         << " (resolved=" << (s_autolootResolved ? 1 : 0)
                         << ", panel=" << (s_lastBagPanel ? "yes" : "no") << ")");
        }
        return;
    }

    void* panel = s_lastBagPanel;
    InteractiveItemSlotArrayLite* arr = nullptr;
    void* eqMgr = nullptr;
    if (!SehReadPanelPtrs(panel, &arr, &eqMgr)) return;
    if (!arr || !eqMgr) return;

    const uint64_t len = (arr->max_length > 32) ? 32 : arr->max_length;
    int swapped = 0;
    for (uint64_t i = 0; i < len; ++i) {
        void* slot = arr->vector[i];
        if (!slot) continue;
        Resolver::Protection::safe_call([&]() {
            s_fnInventorySwap(eqMgr, slot, nullptr);
        });
        ++swapped;
        if (swapped >= 4) break;   // safety: max 4 items per tick to keep packet rate reasonable
    }
    if (swapped > 0) {
        DBG_FILE_LOG("[looter] swapped " << swapped << " slots from bag=" << bagObjectId);
    }
}

ULONGLONG s_lastTickMs = 0;
constexpr ULONGLONG kTickIntervalMs = 250;
// Distance at which we consider the player "on" the bag — clear the
// external goal so the planner returns to lock-follow / idle. The
// game's pickup-panel proximity is ~0.6 tiles in vanilla, we use 0.4
// to make sure we're squarely on top.
constexpr float kArriveDistTiles = 0.4f;

BagLooter::BagTier TierForType(int32_t objType)
{
    for (int i = 0; i < kBagTypeCount; ++i) {
        if (kBagTypes[i].type == objType) return kBagTypes[i].tier;
    }
    return BagLooter::TierCount_;  // sentinel: not a bag
}

} // namespace

namespace BagLooter {

void Tick()
{
    if (!s_enabled.load(std::memory_order_relaxed)) {
        if (s_activeBagId.load(std::memory_order_relaxed) != 0) {
            DangerPlanner::ClearExternalGoal();
            s_activeBagId.store(0, std::memory_order_relaxed);
            s_activeBagDist.store(0.f, std::memory_order_relaxed);
        }
        s_statusTag.store("off", std::memory_order_relaxed);
        return;
    }

    // Throttled heartbeat log — once every ~5 s while enabled, so the
    // trace shows whether the looter is alive without flooding.
    static ULONGLONG s_lastHeartbeatMs = 0;
    {
        const ULONGLONG hb = GetTickCount64();
        if (hb - s_lastHeartbeatMs >= 5000) {
            s_lastHeartbeatMs = hb;
            DBG_FILE_LOG("[looter] tick heartbeat enabled=1 maxDist="
                         << s_maxWalkDist.load(std::memory_order_relaxed));
        }
    }

    const ULONGLONG now = GetTickCount64();
    if (now - s_lastTickMs < kTickIntervalMs) return;
    s_lastTickMs = now;

    const float playerX = LocalPlayer::GetX();
    const float playerY = LocalPlayer::GetY();
    if (!std::isfinite(playerX) || !std::isfinite(playerY)) {
        s_statusTag.store("no-player", std::memory_order_relaxed);
        return;
    }

    // HP gate — never pursue a bag when health is critical. Bags aren't
    // worth dying for, and the planner's external-engagement mode
    // commits through ambient threat (threatScale=0.6), which is the
    // wrong call when one more hit kills you.
    {
        const int32_t hp    = LocalPlayer::GetHP();
        const int32_t maxHp = LocalPlayer::GetMaxHP();
        if (hp > 0 && maxHp > 0) {
            const float pct = static_cast<float>(hp) / static_cast<float>(maxHp);
            if (pct < 0.40f) {
                if (s_activeBagId.load(std::memory_order_relaxed) != 0) {
                    DangerPlanner::ClearExternalGoal();
                    s_activeBagId.store(0, std::memory_order_relaxed);
                    s_activeBagDist.store(0.f, std::memory_order_relaxed);
                }
                s_statusTag.store("hp-gated", std::memory_order_relaxed);
                return;
            }
        }
    }

    // Force-refresh the entity snapshot before scanning. Without this,
    // WorldTAB::GetEntities() returns whatever was last refreshed by
    // the World tab's UI render path — which only runs while the World
    // tab is visible. With the menu closed the snapshot is stale or
    // empty, so the looter would see no bags. ForceRefresh self-
    // coalesces to 50 ms, fine to call at our 250 ms tick cadence.
    WorldTAB::ForceRefresh();
    const std::vector<WorldEntity>& ents = WorldTAB::GetEntities();
    const float maxDist = s_maxWalkDist.load(std::memory_order_relaxed);
    const float maxDistSq = maxDist * maxDist;

    int32_t bestId   = 0;
    float   bestX    = 0.f, bestY = 0.f;
    float   bestSq   = maxDistSq;
    BagTier bestTier = TierCount_;

    int seenAny = 0, seenEnabledTier = 0, seenInRange = 0;
    for (const auto& e : ents) {
        const BagTier tier = TierForType(e.objType);
        if (tier == TierCount_) continue;
        ++seenAny;
        if (!s_tierEnabled[tier].load(std::memory_order_relaxed)) continue;
        ++seenEnabledTier;

        const float dx = e.x - playerX;
        const float dy = e.y - playerY;
        const float distSq = dx * dx + dy * dy;
        if (distSq > maxDistSq) continue;
        ++seenInRange;

        // Tier priority: higher tier wins ties; closer wins within tier.
        // Bias the per-tier rank by 4 tiles² per tier so a Blue bag at
        // 4 tiles beats a Brown bag at 1 tile.
        const float rankSq = distSq - static_cast<float>(tier) * 16.f;
        if (rankSq < bestSq) {
            bestSq   = rankSq;
            bestId   = e.objectId;
            bestX    = e.x;
            bestY    = e.y;
            bestTier = tier;
        }
    }

    if (bestId == 0) {
        // One-shot log when scan transitions from "found bag" to "no bag",
        // OR every ~5 s while idle, so we can see WHY no bag was picked.
        static ULONGLONG s_lastNoBagsLogMs = 0;
        const ULONGLONG nbNow = GetTickCount64();
        const bool wasActive = s_activeBagId.load(std::memory_order_relaxed) != 0;
        if (wasActive || nbNow - s_lastNoBagsLogMs >= 5000) {
            s_lastNoBagsLogMs = nbNow;
            DBG_FILE_LOG("[looter] no-bags entitySnapshot=" << ents.size()
                         << " bagsAnyTier=" << seenAny
                         << " bagsEnabledTier=" << seenEnabledTier
                         << " bagsInRange=" << seenInRange);
        }
        if (wasActive) {
            DangerPlanner::ClearExternalGoal();
            s_activeBagId.store(0, std::memory_order_relaxed);
            s_activeBagDist.store(0.f, std::memory_order_relaxed);
        }
        s_statusTag.store("no-bags", std::memory_order_relaxed);
        return;
    }
    (void)bestTier;

    const float dx = bestX - playerX;
    const float dy = bestY - playerY;
    const float dist = sqrtf(dx * dx + dy * dy);

    if (dist <= kArriveDistTiles) {
        DangerPlanner::ClearExternalGoal();
        s_activeBagId.store(bestId, std::memory_order_relaxed);
        s_activeBagDist.store(dist, std::memory_order_relaxed);

        // Auto-loot / auto-pickup: rate-limited to one attempt per
        // ~350 ms (cheap enough to fire steadily while standing on
        // the bag, slow enough that the IL2CPP call doesn't spam).
        // The actual InventorySwap RPC is gated behind a separate
        // helper so the wiring point is centralized when the
        // LootBagPanel slot-iteration RPC gets RE'd.
        if (s_autoLoot.load(std::memory_order_relaxed) ||
            s_autoPickup.load(std::memory_order_relaxed)) {
            const ULONGLONG nowL = GetTickCount64();
            if (nowL - s_lastLootAttemptMs.load(std::memory_order_relaxed) >= kLootAttemptCooldownMs) {
                s_lastLootAttemptMs.store(nowL, std::memory_order_relaxed);
                ApplyLootAtBag(bestId);
            }
            s_statusTag.store("looting", std::memory_order_relaxed);
        } else {
            s_statusTag.store("arrived", std::memory_order_relaxed);
        }
        return;
    }

    DangerPlanner::SetExternalGoal(bestX, bestY);
    // Log on bag-id transitions only — once per pickup target.
    if (s_activeBagId.load(std::memory_order_relaxed) != bestId) {
        DBG_FILE_LOG("[looter] new target id=" << bestId
                     << " tier=" << bestTier
                     << " bagPos=(" << bestX << "," << bestY << ")"
                     << " dist=" << dist);
    }
    s_activeBagId.store(bestId, std::memory_order_relaxed);
    s_activeBagDist.store(dist, std::memory_order_relaxed);
    s_statusTag.store("walking", std::memory_order_relaxed);
}

void Reset()
{
    if (s_activeBagId.load(std::memory_order_relaxed) != 0) {
        DangerPlanner::ClearExternalGoal();
    }
    s_activeBagId.store(0, std::memory_order_relaxed);
    s_activeBagDist.store(0.f, std::memory_order_relaxed);
    s_statusTag.store("off", std::memory_order_relaxed);
    s_lastTickMs = 0;
}

void SetEnabled(bool on)
{
    const bool prev = s_enabled.exchange(on, std::memory_order_acq_rel);
    if (prev && !on) Reset();
}
bool IsEnabled() { return s_enabled.load(std::memory_order_relaxed); }

void SetTierEnabled(BagTier t, bool on)
{
    if (t < 0 || t >= TierCount_) return;
    s_tierEnabled[t].store(on, std::memory_order_relaxed);
}
bool IsTierEnabled(BagTier t)
{
    if (t < 0 || t >= TierCount_) return false;
    return s_tierEnabled[t].load(std::memory_order_relaxed);
}

void SetMaxWalkDistance(float tiles)
{
    if (!std::isfinite(tiles)) tiles = 12.f;
    if (tiles < 1.f)  tiles = 1.f;
    if (tiles > 40.f) tiles = 40.f;
    s_maxWalkDist.store(tiles, std::memory_order_relaxed);
}
float GetMaxWalkDistance() { return s_maxWalkDist.load(std::memory_order_relaxed); }

void SetAutoLootEnabled(bool on)   { s_autoLoot.store(on, std::memory_order_relaxed); }
bool GetAutoLootEnabled()          { return s_autoLoot.load(std::memory_order_relaxed); }
void SetAutoPickupEnabled(bool on) { s_autoPickup.store(on, std::memory_order_relaxed); }
bool GetAutoPickupEnabled()        { return s_autoPickup.load(std::memory_order_relaxed); }

int32_t GetActiveBagId()       { return s_activeBagId.load(std::memory_order_relaxed); }
float   GetActiveBagDistance() { return s_activeBagDist.load(std::memory_order_relaxed); }
const char* GetLastStatusTag() { return s_statusTag.load(std::memory_order_relaxed); }

} // namespace BagLooter
