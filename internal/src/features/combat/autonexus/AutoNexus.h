#pragma once

#include <cstdint>

namespace CombatTAB {
namespace FeatAutoNexus {

void Tick();
void Render();
bool ConsumesLocalPlayer();

// ── Autonexus tunables (existing) ────────────────────────────────────────
void  SetAutoNexusEnabled(bool on);
void  SetAutoNexusHpPct(float pct);          // 1..95, default 30
void  SetAutoNexusProjPredictEnabled(bool on);
void  SetAutoNexusTilePredictEnabled(bool on);

// ── Autopot (xrDriver pattern — folded into AutoNexus per audit) ─────────
// HP / MP threshold-based pot drinking. Calls
// EquipmentManager.UseInventoryItemByHotkey(slot) when CUR/MAX drops
// below the threshold. The hotkey value follows the game's input enum:
//   0..3   equipped slots (weapon / ability / armor / ring) — DON'T use these
//   4..7   inventory slots 0..3 (typical: F=4, G=5, H=6, J=7)
// Default HP hotkey = 4 (first inv slot, F), MP hotkey = 5 (G).
// Per-pot cooldown is fixed at 800 ms internally so back-to-back ticks
// can't burn an entire pot stack on one HP dip.
void  SetAutoPotHpEnabled(bool on);
void  SetAutoPotHpThresholdPct(float pct);   // 1..99, default 65
void  SetAutoPotHpHotkey(int hotkey);        // 0..15, default 4
void  SetAutoPotMpEnabled(bool on);
void  SetAutoPotMpThresholdPct(float pct);   // 1..99, default 30
void  SetAutoPotMpHotkey(int hotkey);        // 0..15, default 5

// ── External (proxy-driven) damage events — Phase 2 of xrDriver port ─────
// Called from IpcBridge when the bot-client proxy sees an outgoing
// PLAYERHIT or AOEACK packet (silent=false, committed damage). Decrements
// the predicted trackers and triggers Nexus if any HP source drops below
// the threshold. Mirrors xrDriver's AutoNexus::SubtractDamage path.
//   silent=false : decrements both predClientHp + predRealHp
//   silent=true  : decrements only predClientHp (predicted, not yet
//                  confirmed — currently only used internally)
void OnExternalDamage(int32_t dmg, bool silent);

// Server's authoritative HP/MaxHp sync from incoming NEWTICK statuses.
// Snaps both predicted trackers to the new values — matches xrDriver's
// ProcessStatus behavior where the server's Hp stat updates the realHp
// tracker every tick.
void OnExternalHpSync(int32_t hp, int32_t maxHp);

} // namespace FeatAutoNexus
} // namespace CombatTAB
