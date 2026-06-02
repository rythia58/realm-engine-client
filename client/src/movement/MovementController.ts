import type { BridgeDeps } from '../scripts/bridge/BridgeDeps.js';
import type { GameWorldState } from '../state/GameWorldState.js';
import { sendDllFeature } from '../bridge/DllFeatureBus.js';
import { Logger } from '../util/Logger.js';

// Set RE_NAV_DEBUG=1 to enable verbose movement logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

export type WalkResult = 'reached' | 'timeout' | 'cancelled' | 'blocked';

export interface WalkOptions {
  timeoutMs?: number;
  reachThreshold?: number;
  maxRetries?: number; // kept for API compat, unused
}

const DEFAULT_REACH_THRESHOLD = 0.9;
const DEFAULT_TIMEOUT_MS = 20000;
const POLL_MS = 100;
// Stuck detection: if the player hasn't moved this far in this many polls, give up.
const STUCK_DIST = 0.3;
const STUCK_POLLS = 25; // 2.5s of no movement

/**
 * DLL-backed walkTo navigation.
 *
 * Sets walkTargetX/Y/Active on the native DLL via DllFeatureBus.
 * The DLL's movement loop (TestTAB) moves the player and feeds the goal
 * into DangerPlanner so AutoDodge and walking cooperate automatically.
 * Position is polled from playerData to detect arrival, timeout, or stuck.
 *
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [MoveCtrl] walk#N START → (x,y) | timeout=Xms reach=X
 *   [MoveCtrl] walk#N DONE  | result=reached dist=X elapsed=Xms
 *   [MoveCtrl] walk#N DONE  | result=cancelled/timeout elapsed=Xms
 *   [MoveCtrl] walk#N blocked — no connected client / disconnected / stuck
 */
export class MovementController {
  private _active = false;
  private _cancelled = false;
  private _resolveSleep: (() => void) | null = null;

  private static _seq = 0;

  constructor(
    private deps: BridgeDeps,
    // kept for signature compat with existing callers
    _worldState: GameWorldState,
  ) {}

  /** Returns a Promise that resolves when the player reaches (wx, wy) or an exit condition occurs. */
  async walkTo(wx: number, wy: number, opts?: WalkOptions): Promise<WalkResult> {
    if (this._active) {
      if (NAV_DEBUG) Logger.log('MoveCtrl', `interrupting previous walk to start → (${wx.toFixed(2)},${wy.toFixed(2)})`);
      this.cancel();
      await this._sleep(50);
    }

    this._cancelled = false;
    this._active = true;
    const walkId = ++MovementController._seq;
    try {
      return await this._walkLoop(walkId, wx, wy, opts ?? {});
    } catch (err) {
      Logger.warn('MoveCtrl', `walk#${walkId} error: ${(err as Error).message}`);
      return 'blocked';
    } finally {
      this._active = false;
      sendDllFeature('walkTargetActive', false);
    }
  }

  /** Cancel the current walk; resolves the active walkTo Promise with 'cancelled'. */
  cancel(): void {
    this._cancelled = true;
    this._resolveSleep?.();
  }

  isActive(): boolean {
    return this._active;
  }

  private async _walkLoop(walkId: number, wx: number, wy: number, opts: WalkOptions): Promise<WalkResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const reachThreshold = opts.reachThreshold ?? DEFAULT_REACH_THRESHOLD;
    const deadline = Date.now() + timeoutMs;
    const startTime = Date.now();

    const client = this.deps.clientRef.current;
    if (!client?.connected) {
      Logger.warn('MoveCtrl', `walk#${walkId} blocked — no connected client`);
      return 'blocked';
    }

    // Already there?
    const startPos = client.playerData.pos;
    if (Math.hypot(startPos.x - wx, startPos.y - wy) <= reachThreshold) {
      if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=reached (already there)`);
      return 'reached';
    }

    if (NAV_DEBUG) {
      Logger.log('MoveCtrl', `walk#${walkId} START → (${wx.toFixed(2)},${wy.toFixed(2)}) from (${startPos.x.toFixed(2)},${startPos.y.toFixed(2)}) | timeout=${timeoutMs}ms reach=${reachThreshold}`);
    }

    // Arm the DLL walk target
    sendDllFeature('walkTargetX', wx);
    sendDllFeature('walkTargetY', wy);
    sendDllFeature('walkTargetActive', true);

    let stuckPolls = 0;
    let lastPos = { x: startPos.x, y: startPos.y };

    while (true) {
      await this._sleep(POLL_MS);

      if (this._cancelled) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=cancelled elapsed=${Date.now() - startTime}ms`);
        return 'cancelled';
      }

      if (!client.connected) {
        Logger.warn('MoveCtrl', `walk#${walkId} blocked — client disconnected`);
        return 'blocked';
      }

      if (Date.now() > deadline) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=timeout elapsed=${Date.now() - startTime}ms`);
        return 'timeout';
      }

      const pos = client.playerData.pos;
      const dist = Math.hypot(pos.x - wx, pos.y - wy);

      if (dist <= reachThreshold) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=reached dist=${dist.toFixed(3)} elapsed=${Date.now() - startTime}ms`);
        return 'reached';
      }

      // Stuck detection: if position barely changed over STUCK_POLLS intervals
      const moved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y);
      if (moved < STUCK_DIST) {
        stuckPolls++;
        if (stuckPolls >= STUCK_POLLS) {
          Logger.warn('MoveCtrl', `walk#${walkId} blocked — stuck (no movement for ${(STUCK_POLLS * POLL_MS / 1000).toFixed(1)}s, dist=${dist.toFixed(2)})`);
          return 'blocked';
        }
      } else {
        stuckPolls = 0;
        lastPos = { x: pos.x, y: pos.y };
      }
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this._resolveSleep = null;
        resolve();
      }, ms);
      this._resolveSleep = () => {
        clearTimeout(timer);
        this._resolveSleep = null;
        resolve();
      };
    });
  }
}
