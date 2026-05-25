# Auto-dodge Flash parity

Reference: Flash `Projectile.positionAt` in the public client lineage (e.g. Zolmex/RenderBr RotMG Flash `Projectile.as`).

## Implemented parity

| Behavior | Flash | This project |
|----------|-------|----------------|
| Wavy angle | `angle + (π/64) * sin(phase + 6π·t/1000)`, `phase = 0` or `π` by `bulletId % 2` | `ProjectileTracking.cpp` `ProjPosAt` |
| Parametric | `sin(2π·t/L)` and `sin(4π·t/L)` with signs from `bulletId % 2` and `bulletId % 4`; offset scaled by **magnitude** only (no along-ray travel) | `ProjPosAt` when `parametric` |
| Boomerang | Half max distance = `(lifetime · speed · speedMul / 10000) / 2`, reflect past half | `ProjPosAt` |
| Amplitude (non-wavy) | Lateral sine: `amp * sin(phase + (t/L)·freq·2π)` with same `bulletId` phase | After linear/boomerang base |
| Speed | `t * (speed/10000) * speedMul` | `ProjSpeedTpMs` + `ProjPosAt`; `speedMul` from `GetFlashSpeedMultiplier()` (default 1; ImGui **Flash speed mult** in Test tab until a native field is proven) |
| Per-shot hit test | Flash `getHit`: swept AABB of bullet segment, expand by **target** `radius_` only (default 0.5); early-out if movement² < 0.25² | `TestTAB` `FlashProjectileGetHitPlayerCenter`; player `r` = `PlayerHalf()` from fixed `kFlashDodgePlayerHitboxSize` (**1.0** → r=0.5). No bullet-side AABB in the dodge model. |
| Laser | Finite beam along angle | `LaserDistance` @ `ProjectileProperties` +0x170 → `WorldProjectile::laser` / `laserDistance`; `LaserThreatFlashBetween` runs Flash getHit on **consecutive tip positions** (same time sampling as other threats), not spawn→tip |
| Turning | Curved motion | `isTurning` @ +0x1B0, `turnRate` @ +0xD4: `ComputePosAt` **lerps** analytic position with `TryReadLivePos` when live read succeeds; `ProjPosAt` adds `turnRate * (tMs/1000)` angle term. **BUG SUSPECTED**: Exalt XML `TurnAngle` is per-tick (50ms step), making the correct formula `turnRate * (tMs/50)`. Current formula is 20x too slow without the live-pos blend to correct it. |

## Exalt-only / intentional differences

- **Acceleration / speed clamp**: Preserved from IL2CPP `ProjectileProperties`; not present in the Flash snippet above.
  - **BUG**: Decelerating shots (`acceleration < 0`) will predict negative distance once `v₀ + a*t` passes zero — predicted position reverses through spawn point. Fix: clamp effective speed to `max(0, speedClamp/10000*speedMul)`.
  - **BUG**: `speedMul` is not applied to `accelTpMs2`. For shots with both IsAccelerating and non-1.0 speedMul, acceleration is underscaled.
- **Custom hitbox / skin / coll mult**: Still derived from spawn hook + instance reads.
- **Server authority**: Dodge remains client-side prediction; HP events can disagree with local geometry.
- **Lookahead sampling**: `LookaheadStepsFor(projectile)` uses more steps for wavy, parametric, boomerang, laser, or turning shots; linear shots use fewer (CPU vs graze accuracy).

## Logging

- `accuracy_dashboard` (`AD1`) in `debug-1e0679.log`: rolling unsafe % and average threat count — re-run after parity changes to compare baselines.
- `hit_summary` (`H1`): `prevTickCurSafe` flags HP loss after a tick predicted “safe”.
- `hit_bullet_detail` (`H2`): `flashGetHit` vs ~20ms bullet motion segment; `dbgCircleHit` / margins are legacy Exalt-draw diagnostics only (`EffectiveProjectileHalf`).
- `SM1` (`speedmul-hunt`): throttled spawn log of `ProjectileProperties` scalars plus `HBEAKBIHANL` singles/ints (`runtime-dump.txt` has no `speedMul` on `ProjectileProperties`; compare `pi1a4`/`pi1c8`/… to props speed when tuning **Flash speed mult**).

## Twinject VO mode (Movement tab → Auto-dodge mode)

| Behavior | [twinject](https://github.com/Netdex/twinject) `th_vo_algo` | This project |
|----------|-------------------------------------------------------------|----------------|
| Discrete velocities | 17 (`Hold` + 8 directions + 8 “focus” with slower scalar) | Same index layout; focus uses `focus speed mult` × SPD-based tiles/s |
| Direction vectors | Cardinals ±1; diagonals `(±√2, ±√2)` (magnitude 2) | Same table as `movement.h` |
| Per-dir score | `min` hazard time-to-collision (frames) | `min` time in **ms** via `IsSpotSafeAtWorldTime` along `p + v·t` with `worldNow + t` |
| `bounded` | No bullet yields finite `willCollideWith` | Hold-still first-hit time `≥` horizon ⇒ bounded |
| Walls | `willExit` screen AABB | First blocked tile along constant-velocity ray (dirs 1–16) |
| Targeting | Powerups + enemy-below left/right heuristic | Powerups stubbed (`FLT_MAX`); enemy-below **Left/Right** heuristic ported |
| Deathbomb | `DIK_X` if best move &lt; 0.5 frames | Not mapped (no bomb key in Realm) |
| Calibration | 8-phase horizontal wiggle → `playerVel` / `playerFocVel` | Optional (uncheck “Use SPD stat”); default uses SPD → tiles/s |

Auto-dodge modes are **mutually exclusive**: Off, Flash grid, VO, Gravity.

### Flash grid mode (Test tab → Auto-dodge)

| Piece | Behavior |
|-------|----------|
| Trigger | **Time-based**: dodge when `MinStandingImpactFromNowMs` ≤ **Trigger time** (ms), or when inside **Enemy avoid dist** (unchanged). |
| Candidate search | **4-neighbor BFS** on tile centers `(tile+0.5, tile+0.5)` from `floor(player)`, max depth `kBfsWalkMaxDepthTiles` (3). |
| Walk scoring | Same heuristics as before: prefer shallow BFS depth, WASD intent dot, enemy distance, open-direction probes. |
| TP fallback | Second BFS with `IsSpotSafe` at arrival 0, max depth `ceil(TP max dist tiles)` (min 1). |
| Hitbox | **Fixed** 1.0 full width for Flash dodge (`GetPlayerHitboxSize()` = 1.0); no Advanced slider. |

## Canonical API

- `TestTAB::QueryAutoDodgeSpotSafety` — same `BuildAutoDodgeThreats` + `IsSpotSafe` as Flash-grid `AutoDodgeTick`.
- `TestTAB::IsSpotSafeAtWorldTime` — same geometry as `IsSpotSafe`, bullet age from `worldNowMs` (used by VO sampling).
- Safety grid overlay calls `QueryAutoDodgeSpot*` only.
