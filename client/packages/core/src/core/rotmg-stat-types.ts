/**
 * StatData type IDs — aligned with Realm Engine / bot-client
 * `src/constants/StatType.ts` (inventory, backpack, quick slots, HasBackpack).
 * Do not use older pyrelay `StatTypes` for these; IDs shifted (e.g. HasBackpack 75 vs 79).
 */
export const StatType = {
  /** String stat: in-game display name. */
  Name: 31,
  /** Per-tile move speed; see PyRelay `getSpeed` / wire MOVE validation. */
  Speed: 22,
  Inventory0: 8,
  Inventory1: 9,
  Inventory2: 10,
  Inventory3: 11,
  Inventory4: 12,
  Inventory5: 13,
  Inventory6: 14,
  Inventory7: 15,
  Inventory8: 16,
  Inventory9: 17,
  Inventory10: 18,
  Inventory11: 19,
  /** 0 = none, 8 = backpack, 16 = backpack + extender (see bot-client PlayerData). */
  BackpackTier: 130,
  HasBackpack: 75,
  QuickSlot0: 116,
  QuickSlot1: 117,
  QuickSlot2: 118,
  Backpack0: 131,
  Backpack1: 132,
  Backpack2: 133,
  Backpack3: 134,
  Backpack4: 135,
  Backpack5: 136,
  Backpack6: 137,
  Backpack7: 138,
  Backpack8: 139,
  Backpack9: 140,
  Backpack10: 141,
  Backpack11: 142,
  Backpack12: 143,
  Backpack13: 144,
  Backpack14: 145,
  Backpack15: 146
} as const;

export const INVENTORY_SLOT_COUNT = 12;
export const BACKPACK_SLOT_COUNT = 16;
export const QUICK_SLOT_COUNT = 3;
/** First four main slots: weapon, ability, armor, ring (object type per slot, -1 = empty). */
export const EQUIPPED_SLOT_COUNT = 4;
