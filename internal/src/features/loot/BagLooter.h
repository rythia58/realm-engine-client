#pragma once
#include <cstdint>

// BagLooter — phase 1: bag detection + auto-walk to nearest bag.
//
// Per game-thread tick (throttled), scans WorldTAB::GetEntities() for loot
// bags whose object type matches an enabled tier, picks the nearest one
// within `maxWalkDistance`, and routes the dodge planner to it via
// DangerPlanner::SetExternalGoal. When the player is on top of the bag the
// goal is cleared and the planner returns to its previous behavior (lock-
// follow / idle / etc).
//
// Phase 2 (auto-drink stat potions when stat < class cap) and phase 3
// (auto-pickup UT items from bags) are intentionally NOT implemented here —
// both require resolving extra game functions (Player::useItem,
// LootBagPanel pickup RPC) and class-cap data tables. Hooks are left in
// the comments where they would plug in.
namespace BagLooter {

enum BagTier : int {
    Brown      = 0,   // 0x500 — common items
    Pink       = 1,   // 0x506 — basic stat pots, low-tier items
    Purple     = 2,   // 0x507 — better pots, eggs
    Cyan       = 3,   // 0x508 — consumables / stat pots
    Blue       = 4,   // 0x509 — UTs / rare drops
    White      = 5,   // 0x6be (Loot Bag 5 Boost) — UT-tier
    Soulbound  = 6,   // 0x503 — only your own drops
    TierCount_ = 7,
};

void Tick();
void Reset();

void SetEnabled(bool on);
bool IsEnabled();

void SetTierEnabled(BagTier t, bool on);
bool IsTierEnabled(BagTier t);

void  SetMaxWalkDistance(float tiles);   // 1..40, default 12
float GetMaxWalkDistance();

// ── Auto-loot / auto-pickup (production-feature toggles) ────────────────
// AutoLoot: when the player arrives at a bag, transfer items from the
//   bag into the first available player inventory slot. Off by default.
// AutoPickup: variant that only takes items matching the tier filter
//   (e.g. only UTs from a white bag). Off by default.
//
// IMPLEMENTATION NOTE: the actual loot RPC (LootBagPanel slot click /
// EquipmentManager_InventorySwap with bag-slot handle) is not yet wired —
// the full LootBagPanel slot-iteration API is obfuscated and needs RE
// work to map. This module exposes the toggles + IPC keys so bot-client
// UI can drive them; the on-arrival branch in BagLooter::Tick fires
// ApplyLootAtBag() when these are on, and that function is the single
// place to drop in the swap call once the RPC is identified.
void SetAutoLootEnabled(bool on);
bool GetAutoLootEnabled();
void SetAutoPickupEnabled(bool on);
bool GetAutoPickupEnabled();

// Diagnostics — for the Movement-tab status row.
int32_t GetActiveBagId();        // 0 if no bag being pursued
float   GetActiveBagDistance();  // tiles from player; 0 if no active bag
const char* GetLastStatusTag();  // "off" / "no-bags" / "out-of-range" / "walking" / "arrived" / "looting"

} // namespace BagLooter
