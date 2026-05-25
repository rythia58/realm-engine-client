# Dodge Overhaul — Full Plan

Branch: `dodge-weighting` (internal) + `client-dodge-toggles` (client). Nothing
pushed. Base = `be8fc54` (working BFS-only XDodge + prod fixes). User WIP on
the client branch is untouched.

---

## 1. Principles (non-negotiable)

- **Non-invasive.** No new game interaction. Only algorithms + caching of data
  already read through existing connections (live projectile position via
  `ProjectileTracking::TryReadLivePos`/`CopyActiveForDraw`, projectile params at
  spawn, `CalcMoveSpeed`, the AutoNexus damage signal). `NativeMoveTo`, the
  hooks, and every game write stay byte-identical.
- **BFS reflex is the safety floor.** Everything is additive and toggleable;
  every feature OFF ⇒ exact `be8fc54` behavior.
- **Client-controlled.** Each toggle is an IPC key + an `auto-dodge.ts` setting
  (no internal-GUI dependence; GUI mirrors as convenience).
- **Performance guardrails are locked** (Section 5).

## 2. Architecture — repel + attract, one behavior

- **BFS = the repeller (reflex).** 3-D spacetime grid `g_danger[t][gx][gy]`,
  time-accurate, small (~3 t) and player-centered. Owns "a bullet is about to
  hit me": snappy, CCD-exact, razor-tight escape. Untouched by mode logic.
- **A\* = the attractor (strategy).** 2-D search; the danger of entering a cell
  is sampled at the slice matching **when the player would arrive there**
  (arrival-time scoring). Produces a *timed* route through the future bullet
  field. Wide + goal-biased.
- **They share one goal.** The committed goal (orbit ring or survival pocket)
  is chosen by a context/utility arbiter with hysteresis. A* paths to it; BFS,
  when it fires, biases its escape *toward* that goal (safety strictly
  dominates; bias = tiebreak). Latency-gated handoff: imminent → BFS; clear for
  the near window → A*. No tug-of-war, no oscillation.

## 3. Current state (already committed on `dodge-weighting`)

- Weighted severity field + sparse fringe; A* re-introduced; smart goal; perp
  bias; gating fix (imminent vs horizon split); speed-match reduced to the
  per-frame **step clamp** (slice-scaling removed); **walkability cache**
  (kills the game-thread stall → AutoNexus on time); **wall avoidance**
  (fringe + diagonal corner-clip); **lock-follow → A\*** bridge;
  **2-D/3-D map split** (A* on 2-D, BFS on 3-D); C3861 fix.
- Uncommitted/partial: `SelectRingGoal` + ring constants (folds into Phase 2).

## 4. Build plan (ordered phases)

Each phase = ~1 commit, behind a toggle, built/validated incrementally.

**P1 — Wide, goal-biased A\* map (tunable).**
2-D A* radius tunable (default 6 t, up to 8 t). A* grid origin biased toward
the goal (`player + unit(goal) × offset`); BFS 3-D grid stays small +
player-centered. Cheap directional range extension for U-detours / far holes.

**P2 — Arrival-time A\* cost (the correct collapse).**
Replace `Σ sev/(1+t)`. A* tracks accumulated path distance → arrival time =
distance ÷ `g_obsSpeed` → cost of a cell = `f(g_danger[arrivalSlice][cell])`.
Static walls/fringe = flat block + clearance layer. Path becomes a *timed*
dodge plan (be where the bullets won't be).

**P3 — Context/utility goal arbiter + hysteresis.**
Candidates: ring points (orbit/DPS value) vs global-safest reachable cell
(survival). Score vs the arrival-time danger field. Orbit ↔ small deviation ↔
great-deviation/flee emerges (no FSM flip). **Hysteresis on the mode**, not the
cell — the survival target re-tracks the moving safe pocket every rebuild.

**P4 — Lock-on ring/orbit.**
Shift+Click lock (exists) → `ResolveEnemyLock` weapon-range×pad standoff. Goal
= the RING: `SelectRingGoal` picks the safest arc point near current bearing
(slides along/off ring to dodge, returns after). On-ring deadzone = stand still
when on the ring and safe.

**P5 — BFS strategic bias.**
BFS escape gets a secondary tiebreak reward toward the committed A* goal so
dodges go *into the right area*. Safety strictly dominates; bias never trades a
safe cell for a worse one. Toggleable.

**P6 — CCD-exact, tight reflex commit.**
Final escape/commit decision uses continuous collision detection (Jesse's
Precision): `ComputePosAt` + real Chebyshev hitbox, fine sample over the next
~tick — not the 50 ms grid. Lethal core = true game AABB (hitScale ≈ 1, tight
cell-overlap rasterization, no floor/ceil bloat). Margin ≈ 0 (only a hair for
command latency). Restricted to ≤ ~8 commit candidates.

**P7 — Per-type bullet-info cache (ProjectileCatalog reborn).**
First sighting of `(ownerType, bulletType)` → pull params via the existing
spawn read → cache → reuse. **Clears on realm change.** Net perf positive.

**P8 — Continuous prediction-error feedback + path re-correction.**
Every rebuild: predicted (prior rebuild) vs live-actual position per bullet →
per-type residual EMA (sanity-bounded; reject absurd deltas). When a type's
error crosses threshold: detrend the linear carrier, run Goertzel/LSQ on the
**pooled per-type** cross-track residual to correct frequency/amplitude/phase
(along-track → speed/accel); write corrected params to the cache. Interim
safety-pad inflation while confidence builds. A taken **hit is a booster**
(force-flag nearby types) — not the trigger; correction is pre-emptive.

**P9 — Speed-input hardening.**
`g_obsSpeed` (measured realized speed = true effective incl. status/clamp)
remains ground truth for arrival-time + step clamp. Add: floor/seed when
stationary or post-teleport, cross-check/seed with game `CalcMoveSpeed`
(existing connection) for fast response to status changes; keep
teleport-jump rejection.

## 5. Performance guardrails (locked)

1. CCD only on ≤ ~8 commit candidates — never whole-grid.
2. Goertzel re-fit: ≤ 1 suspect type per rebuild, per-type cooldown,
   fixed-size pooled ring buffer.
3. Walkability stays cached; rebuild stays throttled (`g_rebuildN`).
4. Tracked-bullet / live-read count capped for pathological swarms.
5. A* radius tunable, default 6 t (not 8).
6. All phases behind toggles → OFF ⇒ today's exact cost.

Net: per-frame game-thread cost is **lower** than today (the IL2CPP
walkability spam and 3-D A* are gone); new work is pure math on
already-read data. 60 fps lock holds with more headroom than the
current build.

## 6. Deferred / optional

- **Coarse-global tier**: low-res danger map over a much larger radius giving
  A* a global direction hint to defeat local-minima on arena-scale U/hole
  mechanics. Add only if in-game testing shows room-scale failure.

## STATUS: all phases implemented on `dodge-weighting` (build-pending)

P1 `190efcf` · P2 `190efcf` · P3 `f08b38a` · P4 `e686187` · P5 `0629152`
· P6 `0afdeda` · P7 `1bd6276` · P8 `f47716d` · P9 `d0aaa2c`. Client
toggles: `client-dodge-toggles` `bfb4536`. Each phase is a separate,
toggle-gated commit (all OFF ⇒ `be8fc54` behavior). Static-verified
(braces balanced, header/impl parity, IPC keys present, no dangling
symbols); **not yet compiled** — needs an MSVC build pass, iterate on
any errors (as with the earlier C3861 fix). Deviations from plan:
goal-bias is a shared-radius enlargement to 5 t (true independent
biased map = the deferred coarse-global tier); CalcMoveSpeed cross-seed
deferred (band-clamp + motion-gate suffice); P8 hit-booster exposed via
`OnPlayerHit()`/`xdodgeNotifyHit` but the AutoNexus→XDodge call is not
wired (continuous loop is self-sufficient).

## 7. Validation

Can't compile C++ here — user builds `dodge-weighting` + `client-dodge-toggles`
per phase. `dll-trace.log` `[XDodge] plan:` line shows `imminent/hasGoal/
goalDist/tier` to confirm A* vs BFS behavior. Tune knobs: A* radius,
`kImminentT`, CCD pad, `g_a2dW`, hysteresis dwell, residual thresholds.
