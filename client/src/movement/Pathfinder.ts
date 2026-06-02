import type { GameWorldState } from '../state/GameWorldState.js';
import type { GameDataLoader } from '../game-data/GameDataLoader.js';
import { Logger } from '../util/Logger.js';

// Set RE_NAV_DEBUG=1 to enable verbose pathfinder + movement logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

export interface PathfinderOptions {
  maxNodes?: number;
  allowPartial?: boolean;
}

// Packed key encoding matches GameWorldState tile map: (tx << 16) | (ty & 0xffff)
function pack(tx: number, ty: number): number {
  return (tx << 16) | (ty & 0xffff);
}

function unpackX(k: number): number {
  return k >> 16;
}

function unpackY(k: number): number {
  return k & 0xffff;
}

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** Binary min-heap keyed by [fScore, packedTileKey]. */
class MinHeap {
  private heap: [number, number][] = [];

  push(fScore: number, key: number): void {
    this.heap.push([fScore, key]);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): [number, number] | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent]![0] <= this.heap[i]![0]) break;
      const tmp = this.heap[parent]!;
      this.heap[parent] = this.heap[i]!;
      this.heap[i] = tmp;
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l]![0] < this.heap[smallest]![0]) smallest = l;
      if (r < n && this.heap[r]![0] < this.heap[smallest]![0]) smallest = r;
      if (smallest === i) break;
      const tmp = this.heap[smallest]!;
      this.heap[smallest] = this.heap[i]!;
      this.heap[i] = tmp;
      i = smallest;
    }
  }
}

/**
 * A* grid pathfinder over the GameWorldState tile map.
 *
 * Walkability rules:
 *   - Unknown tile (not yet received in UPDATE): optimistically walkable.
 *   - Known tile with getTileSpeed === 0: impassable (wall/void/lava).
 *   - All other known tiles: walkable.
 *
 * Uses 4-directional movement. Returns tile-center waypoints
 * (tx + 0.5, ty + 0.5) from the first step after `from` through the goal.
 * If the node budget is exhausted and allowPartial is true, returns a path
 * to the closest-to-goal tile reached.
 *
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [Pathfinder] from (fx,fy) tile (tx,ty) → goal (gx,gy) | manhattan=N maxNodes=N
 *   [Pathfinder] COMPLETE   | nodes=N blocked=N waypoints=N
 *   [Pathfinder] PARTIAL    | nodes=N blocked=N waypoints=N hDist=N (budget exhausted)
 *   [Pathfinder] EMPTY      | nodes=N blocked=N (no path, budget or no start)
 *   [Pathfinder] SAME-TILE  | already at destination tile
 */
export function findPath(
  worldState: GameWorldState,
  gameData: GameDataLoader,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts?: PathfinderOptions,
): Array<{ x: number; y: number }> {
  const maxNodes = opts?.maxNodes ?? 4000;
  const allowPartial = opts?.allowPartial ?? true;

  const startTx = Math.floor(from.x);
  const startTy = Math.floor(from.y);
  const goalTx = Math.floor(to.x);
  const goalTy = Math.floor(to.y);

  if (startTx === goalTx && startTy === goalTy) {
    if (NAV_DEBUG) Logger.log('Pathfinder', `SAME-TILE | tile (${startTx},${startTy}) world (${from.x.toFixed(2)},${from.y.toFixed(2)}) → (${to.x.toFixed(2)},${to.y.toFixed(2)})`);
    return [];
  }

  if (NAV_DEBUG) {
    const manhattan = Math.abs(goalTx - startTx) + Math.abs(goalTy - startTy);
    Logger.log('Pathfinder', `from (${from.x.toFixed(2)},${from.y.toFixed(2)}) tile (${startTx},${startTy}) → goal (${to.x.toFixed(2)},${to.y.toFixed(2)}) tile (${goalTx},${goalTy}) | manhattan=${manhattan} maxNodes=${maxNodes}`);
  }

  const startKey = pack(startTx, startTy);
  const goalKey = pack(goalTx, goalTy);

  const gScore = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();

  gScore.set(startKey, 0);

  const h = (tx: number, ty: number): number =>
    Math.abs(tx - goalTx) + Math.abs(ty - goalTy);

  let blockedCount = 0;
  const isWalkable = (tx: number, ty: number): boolean => {
    const tileType = worldState.getTileAt(tx, ty);
    if (tileType === undefined) return true; // optimistic for unexplored tiles
    const walkable = gameData.getTileSpeed(tileType) > 0;
    if (!walkable) blockedCount++;
    return walkable;
  };

  const open = new MinHeap();
  open.push(h(startTx, startTy), startKey);

  let nodesExpanded = 0;
  let bestPartialKey = startKey;
  let bestPartialH = h(startTx, startTy);

  while (open.size > 0 && nodesExpanded < maxNodes) {
    const item = open.pop();
    if (!item) break;
    const [, currentKey] = item;

    if (currentKey === goalKey) {
      const path = reconstructPath(parent, startKey, goalKey, to.x, to.y);
      if (NAV_DEBUG) Logger.log('Pathfinder', `COMPLETE | nodes=${nodesExpanded} blocked=${blockedCount} waypoints=${path.length}`);
      return path;
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    nodesExpanded++;

    const cx = unpackX(currentKey);
    const cy = unpackY(currentKey);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const { dx, dy } of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;

      const neighborKey = pack(nx, ny);
      if (closed.has(neighborKey)) continue;

      const tentativeG = currentG + 1;
      if (tentativeG >= (gScore.get(neighborKey) ?? Infinity)) continue;

      gScore.set(neighborKey, tentativeG);
      parent.set(neighborKey, currentKey);

      const neighborH = h(nx, ny);
      if (neighborH < bestPartialH) {
        bestPartialH = neighborH;
        bestPartialKey = neighborKey;
      }

      open.push(tentativeG + neighborH, neighborKey);
    }
  }

  // Goal not reached — return partial path to closest node if allowed
  if (!allowPartial || bestPartialKey === startKey) {
    if (NAV_DEBUG) Logger.log('Pathfinder', `EMPTY | nodes=${nodesExpanded} blocked=${blockedCount} openLeft=${open.size} allowPartial=${allowPartial}`);
    return [];
  }
  const bx = unpackX(bestPartialKey);
  const by = unpackY(bestPartialKey);
  const path = reconstructPath(parent, startKey, bestPartialKey, bx + 0.5, by + 0.5);
  if (NAV_DEBUG) Logger.log('Pathfinder', `PARTIAL | nodes=${nodesExpanded} blocked=${blockedCount} waypoints=${path.length} hDistToGoal=${bestPartialH} (budget exhausted at ${maxNodes})`);
  return path;
}

function reconstructPath(
  parent: Map<number, number>,
  startKey: number,
  endKey: number,
  endX: number,
  endY: number,
): Array<{ x: number; y: number }> {
  const keys: number[] = [];
  let cur = endKey;
  while (cur !== startKey) {
    keys.push(cur);
    const p = parent.get(cur);
    if (p === undefined) break;
    cur = p;
  }
  keys.reverse();

  const result: Array<{ x: number; y: number }> = [];
  // All intermediate waypoints use tile centers
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    result.push({ x: unpackX(k) + 0.5, y: unpackY(k) + 0.5 });
  }
  // Final waypoint uses the actual target position (or partial-path tile center)
  result.push({ x: endX, y: endY });
  return result;
}
