#pragma once

namespace CombatTAB {

/// Max distance from local player (tiles) for wizard auto-ability aim point.
constexpr float kWizardSpellMaxRangeTiles = 13.f;

void Render();
// Called every frame from dPresent (outside menu visibility gate).
void Tick(bool menuVisible);

// World-space ground target auto-ability uses (before native Y invert).

// Bot-client shared-memory → mirror dashboard toggles / sliders.

// Muzzle / weapon-range debug overlay (DebugTAB draws when true).
bool MuzzleWeaponRangeDebugOverlayEnabled();

} // namespace CombatTAB
