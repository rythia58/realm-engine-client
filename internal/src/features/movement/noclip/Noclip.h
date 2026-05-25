#pragma once

// Noclip — global "ignore walkability" flag consumed by movement-validating
// modules. Lighter-weight than xrDriver's full client-side tile-swap approach
// (which needs the game's tile-dictionary fields RE'd), but functional and
// safe: when on, our movement and dodge modules skip their walkability
// gates so the planner walks through walls and the corrector accepts any
// destination. The server's own collision check still applies — moves
// onto IMPASSABLE tiles will snap back, but moves through walls between
// open cells (the common "let me skip this corridor" case) succeed.
//
// Production list calls for "noclip" (this) and "projectile noclip"
// (already implemented in src/features/combat/autoaim/ProjNoclip).
//
// Modes:
//   0 = Off                 — normal walkability checks
//   1 = Always On           — always skip walkability
//   2 = Auto (when blocked) — only skip after a snap-back; reverts after a
//                              successful move (TODO — currently behaves as
//                              Always On until snap-back detection lands)
namespace Noclip {

void SetEnabled(bool on);
bool IsEnabled();

void SetMode(int mode);              // 0..2; default 0
int  GetMode();

// True when consumers should skip their walkability gate this frame.
// In Mode 1 (Always On) this returns true continuously while enabled.
// In Mode 2 (Auto) this returns true only inside a "snap-back window" —
// the ~500 ms after MovementCorrector observes a player-position
// discrepancy that suggests the server snapped us back. Outside that
// window, walkability is enforced normally.
bool ShouldBypassWalkable();

// MovementCorrector calls this when it detects a snap-back (the
// player's actual XY diverges from the last requested commit by more
// than expected walk-distance). Opens the auto-mode bypass window.
void ReportSnapback();

} // namespace Noclip
