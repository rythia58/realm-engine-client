#pragma once

#include <cstdint>

// AutoAbility — class-aware automatic ability use. No user-facing modes;
// behaviour is picked from the local player's class:
//   TargetEnemy (Archer, Wizard, Samurai, Knight, Assassin, Necromancer,
//     Huntress, Mystic, Sorcerer, Ninja, Summoner): fires at the AutoAim
//     target, only while AutoAim has one.
//   SelfNoPos (Priest, Bard, Warrior, Paladin, Rogue): fires nonstop above
//     the MP floor.
//   Trickster/Kensei never fire; the client also blocks any teleport/dash
//     ability item (e.g. Planewalker).
// Firing is gated only by the MP floor and a rate limit; the game itself
// rejects a use that is genuinely on cooldown.
namespace AutoAbility {

void Tick();

bool IsEnabled();
void SetEnabled(bool on);

// MP floor in percent, 0..100. 0 = fire whenever the game allows.
void SetMpThresholdPct(float pct);

// Item type in the ability slot (inventory[1]), pushed by the client. <= 0
// = unknown.
void    SetAbilityItemType(int32_t itemType);
int32_t GetAbilityItemType();

} // namespace AutoAbility
