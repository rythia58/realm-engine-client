#pragma once
#include <cstdint>

// Static reference data for the loot/auto-drink subsystem. Values are
// extracted from internal/Multitool/Objects.xml. Class stat caps come
// from each class's Object node; potion type IDs come from the items
// section.
//
// All values are at-build-time constants. Game-version drift would need
// a re-extract — usually a once-per-major-update task.
namespace LootData {

// Stats we track for "drink potion if below cap" decisions. Order
// matters: PotKind below indexes into the same enum.
enum Stat : int {
    Stat_MaxHP = 0,
    Stat_MaxMP = 1,
    Stat_Att   = 2,
    Stat_Def   = 3,
    Stat_Spd   = 4,
    Stat_Dex   = 5,
    Stat_Vit   = 6,
    Stat_Wis   = 7,
    Stat_Count_,
};

// What a given potion type id consumes into. Health/Magic potions are
// non-permanent (current HP/MP refill); StatPot_* are permanent +1 / +5.
enum PotKind : int {
    Pot_None      = 0,
    Pot_HealNow   = 1,    // current HP refill (Health Potion / Greater)
    Pot_ManaNow   = 2,    // current MP refill (Magic Potion / Greater)
    Pot_StatLife  = 3,    // permanent MaxHP +5
    Pot_StatMana  = 4,    // permanent MaxMP +5
    Pot_StatAtt   = 5,
    Pot_StatDef   = 6,
    Pot_StatSpd   = 7,
    Pot_StatDex   = 8,
    Pot_StatVit   = 9,
    Pot_StatWis   = 10,
};

struct PotEntry {
    int32_t  objectType;
    PotKind  kind;
};

// Object-type → potion kind map. Sparse list; lookups are linear (~20
// entries, frequency is per-tick-of-bag-arrival, not per-frame).
constexpr PotEntry kPotionTable[] = {
    // Permanent stat potions
    { 0x0ae9, Pot_StatLife },   // Potion of Life       (MaxHP +5)
    { 0x0aea, Pot_StatMana },   // Potion of Mana       (MaxMP +5)
    { 0x0a1f, Pot_StatAtt  },   // Potion of Attack
    { 0x0a20, Pot_StatDef  },   // Potion of Defense
    { 0x0a21, Pot_StatSpd  },   // Potion of Speed
    { 0x0a4c, Pot_StatDex  },   // Potion of Dexterity
    { 0x0a34, Pot_StatVit  },   // Potion of Vitality
    { 0x0a35, Pot_StatWis  },   // Potion of Wisdom
    { 0x2368, Pot_StatAtt  },   // Greater Potion of Attack
    { 0x2369, Pot_StatDef  },   // Greater Potion of Defense
    { 0x1559, Pot_StatAtt  },   // Potion of Attack (SB)
    { 0x1560, Pot_StatMana },   // Potion of Mana (SB)
    // Non-permanent (current HP/MP refill)
    { 0x0a22, Pot_HealNow  },   // Health Potion
    { 0x0aeb, Pot_HealNow  },   // Greater Health Potion
    { 0x0a23, Pot_ManaNow  },   // Magic Potion
    { 0x0aec, Pot_ManaNow  },   // Greater Magic Potion
};
constexpr int kPotionCount = sizeof(kPotionTable) / sizeof(kPotionTable[0]);

// Look up potion kind for a given object type. Returns Pot_None if not
// a known potion (including Brown-bag trash).
constexpr PotKind PotionKindForType(int32_t objType)
{
    for (int i = 0; i < kPotionCount; ++i) {
        if (kPotionTable[i].objectType == objType) return kPotionTable[i].kind;
    }
    return Pot_None;
}

// Per-class stat caps. Indexed by class ID (object type) — we store as
// a sparse table since the IDs are spread out. Access via
// LookupClassCaps(classId).
struct ClassCaps {
    int32_t classId;
    int32_t maxHp;
    int32_t maxMp;
    int32_t att;
    int32_t def;
    int32_t spd;
    int32_t dex;
    int32_t vit;
    int32_t wis;
};

constexpr ClassCaps kClassCaps[] = {
    // classId,    HP,  MP,  ATT, DEF, SPD, DEX, VIT, WIS
    { 0x0300,      750, 300, 55,  25,  65,  75,  40,  50 },   // Rogue
    { 0x0307,      750, 300, 75,  25,  55,  50,  40,  50 },   // Archer
    { 0x030e,      700, 400, 60,  25,  50,  75,  40,  60 },   // Wizard
    { 0x0310,      700, 400, 65,  25,  55,  60,  40,  75 },   // Priest
    { 0x031d,      800, 300, 75,  25,  50,  50,  75,  50 },   // Warrior
    { 0x031e,      800, 300, 50,  40,  50,  50,  75,  50 },   // Knight
    { 0x031f,      800, 300, 55,  30,  55,  55,  60,  75 },   // Paladin
    { 0x0320,      750, 350, 65,  25,  65,  75,  40,  60 },   // Assassin
    { 0x0321,      700, 400, 75,  25,  50,  60,  40,  75 },   // Necromancer
    { 0x0322,      750, 350, 65,  25,  50,  60,  40,  60 },   // Huntress
    { 0x0323,      700, 400, 65,  25,  60,  65,  40,  75 },   // Mystic
    { 0x0324,      750, 300, 65,  25,  75,  75,  40,  60 },   // Trickster
    { 0x0325,      700, 400, 70,  25,  60,  60,  75,  60 },   // Sorcerer
    { 0x0326,      800, 300, 70,  25,  60,  70,  60,  70 },   // Ninja
    { 0x0311,      800, 300, 75,  30,  55,  55,  60,  60 },   // Samurai
    { 0x031c,      750, 400, 55,  25,  55,  70,  45,  75 },   // Bard
    { 0x0331,      700, 400, 60,  25,  60,  75,  40,  75 },   // Summoner
    { 0x0332,      800, 300, 65,  25,  60,  65,  60,  50 },   // Kensei
    { 0x0333,      750, 350, 60,  25,  60,  65,  40,  75 },   // Druid
};
constexpr int kClassCapsCount = sizeof(kClassCaps) / sizeof(kClassCaps[0]);

// Look up class caps. Returns nullptr if class id is unknown (e.g. new
// class in a future patch); caller should treat as "skip drinking" so
// we don't overshoot a real cap.
constexpr const ClassCaps* LookupClassCaps(int32_t classId)
{
    for (int i = 0; i < kClassCapsCount; ++i) {
        if (kClassCaps[i].classId == classId) return &kClassCaps[i];
    }
    return nullptr;
}

// Health/Mana refill thresholds. Drink a Health Potion only if current
// HP is below this fraction of max; same for Mana. Tuned to leave a
// little headroom (drinking at 95% wastes the heal).
constexpr float kHealNowDrinkPct = 0.85f;
constexpr float kManaNowDrinkPct = 0.85f;

} // namespace LootData
