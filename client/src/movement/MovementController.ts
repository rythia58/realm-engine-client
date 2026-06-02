import type { BridgeDeps } from '../scripts/bridge/BridgeDeps.js';
import type { GameWorldState } from '../state/GameWorldState.js';
import type { ClientConnection } from '../proxy/ClientConnection.js';
import { findPath } from './Pathfinder.js';
import { getCalibratedMoveTilesPerSecond } from './wasd-speed.js';
import { Logger } from '../util/Logger.js';

// Set RE_NAV_DEBUG=1 to enable verbose movement logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

export type WalkResult = 'reached' | 'timeout' | 'cancelled' | 'blocked';

export interface WalkOptions {
  timeoutMs?: number;
  reachThreshold?: number;
  maxRetries?: number;
}

const DEFAULT_REACH_THRESHOLD = 0.9;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 4;
const DODGE_SETTLE_MS = 400;
const MIN_STEP_MS = 80;
const MAX_STEP_MS = 500;

/**
 * Handles A*-based walkTo navigation by injecting MOVE packets.
 *
 * AutoDodge cooperation: after each MOVE the controller sleeps for the
 * expected travel time, then checks how far the actual position diverged
 * from the commanded waypoint. A large divergence indicates AutoDodge
 * deflected the player; the controller waits briefly for the dodge to
 * settle, then replans from the new position.
 *
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [MoveCtrl] walk#N START → (x,y) | timeout=Xms reach=X retries=N
 *   [MoveCtrl] walk#N plan  | from (fx,fy) waypoints=N retriesLeft=N
 *   [MoveCtrl] walk#N step  I/N | curr (cx,cy) → wp (wx,wy) dist=X tps=X wait=Xms
 *   [MoveCtrl] walk#N DODGE | expected (ex,ey) actual (ax,ay) δ=X threshold=X | settling Xms replan #I
 *   [MoveCtrl] walk#N SKIP  | already past wp I/N (dist X ≤ reach X)
 *   [MoveCtrl] walk#N EXHAUSTED | replan #I → N waypoints
 *   [MoveCtrl] walk#N DONE  | result=reached elapsed=Xms steps=N replans=N
 *
 * Errors (always visible):
 *   [MoveCtrl] walk#N blocked — no path found on replan #I
 *   [MoveCtrl] walkTo error: <message>
 */
export class MovementController {
  private _active = false;
  private _cancelled = false;
  private _resolveSleep: (() => void) | null = null;

  private static _seq = 0;

  constructor(
    private deps: BridgeDeps,
    private worldState: GameWorldState,
  ) {}

  /** Returns a Promise that resolves when the player reaches (wx, wy) or an exit condition occurs. */
  async walkTo(wx: number, wy: number, opts?: WalkOptions): Promise<WalkResult> {
    // Cancel any in-progress walk before starting a new one
    if (this._active) {
      if (NAV_DEBUG) Logger.log('MoveCtrl', `interrupting previous walk to start → (${wx.toFixed(2)},${wy.toFixed(2)})`);
      this.cancel();
      await this._sleep(50); // let the previous walk unwind
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
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const deadline = Date.now() + timeoutMs;
    const startTime = Date.now();

    let retriesLeft = maxRetries;
    let totalSteps = 0;
    let totalReplans = 0;

    const client = this.deps.clientRef.current;
    if (!client?.connected) {
      Logger.warn('MoveCtrl', `walk#${walkId} blocked — no connected client`);
      return 'blocked';
    }

    if (NAV_DEBUG) {
      Logger.log('MoveCtrl', `walk#${walkId} START → (${wx.toFixed(2)},${wy.toFixed(2)}) | timeout=${timeoutMs}ms reach=${reachThreshold} retries=${maxRetries}`);
    }

    const doReplan = (label: string): Array<{ x: number; y: number }> => {
      const pos = client.playerData.pos;
      const path = findPath(this.worldState, this.deps.gameData, pos, { x: wx, y: wy });
      if (NAV_DEBUG) {
        Logger.log('MoveCtrl', `walk#${walkId} plan  | ${label} from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) waypoints=${path.length} retriesLeft=${retriesLeft}`);
      }
      return path;
    };

    let waypoints = doReplan('initial');
    let waypointIndex = 0;

    if (waypoints.length === 0) {
      const pos = client.playerData.pos;
      const dist = Math.hypot(pos.x - wx, pos.y - wy);
      if (dist <= reachThreshold) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=reached (already there) dist=${dist.toFixed(3)}`);
        return 'reached';
      }
      Logger.warn('MoveCtrl', `walk#${walkId} blocked — no initial path found (dist=${dist.toFixed(2)})`);
      return 'blocked';
    }

    while (true) {
      if (this._cancelled) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=cancelled elapsed=${Date.now()-startTime}ms steps=${totalSteps} replans=${totalReplans}`);
        return 'cancelled';
      }
      const elapsed = Date.now() - startTime;
      if (Date.now() > deadline) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=timeout elapsed=${elapsed}ms steps=${totalSteps} replans=${totalReplans}`);
        return 'timeout';
      }
      if (!client.connected) {
        Logger.warn('MoveCtrl', `walk#${walkId} blocked — client disconnected at step ${totalSteps}`);
        return 'blocked';
      }

      const pos = client.playerData.pos;
      const goalDist = Math.hypot(pos.x - wx, pos.y - wy);

      if (goalDist <= reachThreshold) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=reached dist=${goalDist.toFixed(3)} elapsed=${Date.now()-startTime}ms steps=${totalSteps} replans=${totalReplans}`);
        return 'reached';
      }

      // Path exhausted — replan if retries remain
      if (waypointIndex >= waypoints.length) {
        if (retriesLeft <= 0) {
          Logger.warn('MoveCtrl', `walk#${walkId} blocked — path exhausted, no retries left (steps=${totalSteps})`);
          return 'blocked';
        }
        retriesLeft--;
        totalReplans++;
        waypoints = doReplan(`exhausted replan #${totalReplans}`);
        waypointIndex = 0;
        if (waypoints.length === 0) {
          Logger.warn('MoveCtrl', `walk#${walkId} blocked — replan #${totalReplans} found no path (dist=${goalDist.toFixed(2)})`);
          return 'blocked';
        }
        continue;
      }

      const waypoint = waypoints[waypointIndex]!;
      const wpDist = Math.hypot(pos.x - waypoint.x, pos.y - waypoint.y);

      // Skip waypoints already passed
      if (wpDist <= reachThreshold) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} SKIP  | wp ${waypointIndex+1}/${waypoints.length} (${waypoint.x.toFixed(2)},${waypoint.y.toFixed(2)}) dist=${wpDist.toFixed(3)} ≤ reach=${reachThreshold}`);
        waypointIndex++;
        continue;
      }

      // Send MOVE packet toward this waypoint
      const tps = getCalibratedMoveTilesPerSecond(client);
      const travelMs = tps > 0 ? Math.ceil((wpDist / tps) * 1000) : 200;
      const stepMs = Math.max(MIN_STEP_MS, Math.min(travelMs, MAX_STEP_MS));

      if (NAV_DEBUG) {
        Logger.log('MoveCtrl', `walk#${walkId} step  ${waypointIndex+1}/${waypoints.length} | curr (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) → wp (${waypoint.x.toFixed(2)},${waypoint.y.toFixed(2)}) dist=${wpDist.toFixed(3)} tps=${tps.toFixed(2)} wait=${stepMs}ms`);
      }

      const sent = this._sendMove(client, waypoint.x, waypoint.y);
      if (!sent) {
        await this._sleep(100);
        continue;
      }
      totalSteps++;

      const expectedX = waypoint.x;
      const expectedY = waypoint.y;

      await this._sleep(stepMs);
      if (this._cancelled) {
        if (NAV_DEBUG) Logger.log('MoveCtrl', `walk#${walkId} DONE | result=cancelled elapsed=${Date.now()-startTime}ms steps=${totalSteps} replans=${totalReplans}`);
        return 'cancelled';
      }

      // Detect AutoDodge deflection: compare actual position to commanded waypoint
      const afterPos = client.playerData.pos;
      const deflection = Math.hypot(afterPos.x - expectedX, afterPos.y - expectedY);
      const deflectThreshold = reachThreshold * 2.5;

      if (deflection > deflectThreshold) {
        if (NAV_DEBUG) {
          Logger.log('MoveCtrl', `walk#${walkId} DODGE | expected (${expectedX.toFixed(2)},${expectedY.toFixed(2)}) actual (${afterPos.x.toFixed(2)},${afterPos.y.toFixed(2)}) δ=${deflection.toFixed(3)} > ${deflectThreshold.toFixed(3)} | settling ${DODGE_SETTLE_MS}ms retriesLeft=${retriesLeft}`);
        }
        await this._sleep(DODGE_SETTLE_MS);
        if (this._cancelled) return 'cancelled';
        if (retriesLeft <= 0) {
          Logger.warn('MoveCtrl', `walk#${walkId} blocked — dodge+replan retries exhausted (deflection=${deflection.toFixed(2)})`);
          return 'blocked';
        }
        retriesLeft--;
        totalReplans++;
        waypoints = doReplan(`dodge replan #${totalReplans}`);
        waypointIndex = 0;
        if (waypoints.length === 0) {
          Logger.warn('MoveCtrl', `walk#${walkId} blocked — no path after dodge replan #${totalReplans}`);
          return 'blocked';
        }
        continue;
      }

      // Advance if close enough to waypoint
      const nowPos = client.playerData.pos;
      if (Math.hypot(nowPos.x - waypoint.x, nowPos.y - waypoint.y) <= reachThreshold) {
        waypointIndex++;
      }
    }
  }

  private _sendMove(client: ClientConnection, x: number, y: number): boolean {
    try {
      const pkt = this.deps.proxy.packetFactory.createByName('MOVE');
      pkt.data = {
        tickId: client.lastNewTickId,
        serverRealTimeMSofLastNewTick: client.lastServerRealTimeMs,
        records: [{ time: client.time, x, y }],
      };
      pkt.modified = true;
      client.sendToServer(pkt);
      return true;
    } catch (err) {
      Logger.warn('MoveCtrl', `_sendMove failed: ${(err as Error).message}`);
      return false;
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
