import type { VisualScriptGraph, VisualScriptNode } from './VisualScriptTypes.js';
import { getNodeImpl, getNodeDef } from './NodeRegistry.js';

export interface Vec2 { x: number; y: number; }

export interface NodeContext {
  getPlayerPos(): Vec2 | null;
  getPlayerStats(): { hp: number; maxHp: number; mp: number; maxMp: number; level: number } | null;
  hasEffect(name: string): boolean;
  playerCount(radius: number): number;
  listPlayers(): Array<{ name: string; x: number; y: number }>;
  teleportToPlayer(name: string): boolean;
  teleportToBeacon(objectId: number): boolean;
  canTeleport(): boolean;
  setPluginEnabled(pluginId: string, enabled: boolean): boolean;
  setDllFeature(key: string, value: boolean | number | string): void;
  notify(text: string): void;
  listObjects(filter: string, radius: number): Array<{ id: number; type: number; name: string; x: number; y: number; dist: number }>;
  questTarget(): { id: number; x: number; y: number } | null;
  moveTo(x: number, y: number): void;
  stopMoving(): void;
  hasReached(x: number, y: number, tol: number): boolean;
  enterPortal(objectId?: number): boolean;
  useItem(slot: number): boolean;
  sendChat(text: string): void;
  nexus(): void;
  resetTileCache(): void;
  mapName(): string;
  savePosition(slot: string, pos: Vec2): void;
  getSavedPosition(slot: string): Vec2 | null;
  log(line: string, level?: 'info' | 'warn' | 'error'): void;
}

export interface FlowEvent { type: 'hotkey' | 'mapChange' | 'chat'; payload: Record<string, unknown>; }

export interface FlowResult {
  out?: string;
  sleepMs?: number;
  jumpTo?: string;
  waitMove?: { x: number; y: number; tol: number; timeoutMs: number };
  stop?: boolean;
}

export interface ExecArgs {
  node: VisualScriptNode;
  param<T>(key: string, fallback: T): T;
  input(port: string): unknown;
  ctx: NodeContext;
  state: Record<string, unknown>;
  stateOf(nodeId: string): Record<string, unknown>;
  event?: FlowEvent;
}

interface SeqFrame { nodeId: string; outIndex: number; }

const MAX_STEPS_PER_TICK = 200;
const IDLE_SLEEP_MS = 250;
const MOVE_POLL_MS = 100;

export class GraphInterpreter {
  private graph: VisualScriptGraph;
  private ctx: NodeContext;
  private nodesById = new Map<string, VisualScriptNode>();
  private flowTargets = new Map<string, string>();
  private dataSources = new Map<string, { from: string; fromPort: string }>();

  private current: string | null = null;
  private seqStack: SeqFrame[] = [];
  private waitUntil = 0;
  private pendingMove: { x: number; y: number; tol: number; deadline: number; resume: string | null } | null = null;
  private eventQueue: FlowEvent[] = [];
  private activeEvent: FlowEvent | undefined;
  private nodeState = new Map<string, Record<string, unknown>>();
  private dataMemo = new Map<string, Record<string, unknown>>();
  private lastProgressAt = 0;
  private stopped = false;

  activeNodeId: string | null = null;

  constructor(graph: VisualScriptGraph, ctx: NodeContext) {
    this.graph = graph;
    this.ctx = ctx;
    for (const n of graph.nodes) this.nodesById.set(n.id, n);
    for (const l of graph.links) {
      if (l.kind === 'flow') this.flowTargets.set(`${l.from}:${l.fromPort}`, l.to);
      else this.dataSources.set(`${l.to}:${l.toPort}`, { from: l.from, fromPort: l.fromPort });
    }
  }

  onStart(): void {
    this.stopped = false;
    this.lastProgressAt = Date.now();
    this.startFromEntry('Start');
  }

  onStop(): void {
    this.stopped = true;
    this.current = null;
    this.pendingMove = null;
    try { this.ctx.stopMoving(); } catch { /* ignore */ }
  }

  postEvent(ev: FlowEvent): void {
    if (this.eventQueue.length < 32) this.eventQueue.push(ev);
  }

  private startFromEntry(type: string, ev?: FlowEvent): boolean {
    for (const n of this.graph.nodes) {
      if (n.type !== type) continue;
      if (ev && !this.entryMatches(n, ev)) continue;
      this.current = n.id;
      this.seqStack = [];
      this.activeEvent = ev;
      return true;
    }
    return false;
  }

  private entryMatches(node: VisualScriptNode, ev: FlowEvent): boolean {
    const p = (k: string) => String(node.params[k] ?? '').trim().toLowerCase();
    if (node.type === 'Hotkey' && ev.type === 'hotkey')
      return p('key') !== '' && p('key') === String(ev.payload.key ?? '').toLowerCase();
    if (node.type === 'MapChange' && ev.type === 'mapChange') {
      const filter = p('mapContains');
      return filter === '' || String(ev.payload.map ?? '').toLowerCase().includes(filter);
    }
    if (node.type === 'ReceivedMessage' && ev.type === 'chat') {
      const filter = p('contains');
      return filter === '' || String(ev.payload.text ?? '').toLowerCase().includes(filter);
    }
    return false;
  }

  idleFor(): number {
    return Date.now() - this.lastProgressAt;
  }

  restart(): void {
    this.current = null;
    this.seqStack = [];
    this.pendingMove = null;
    this.waitUntil = 0;
    this.nodeState.clear();
    this.lastProgressAt = Date.now();
    this.startFromEntry('Start');
  }

  isIdle(): boolean {
    return this.current === null && this.seqStack.length === 0 && !this.pendingMove && this.waitUntil <= Date.now();
  }

  onLoop(): number {
    if (this.stopped) return -1;
    const now = Date.now();

    if (this.waitUntil > now) return Math.min(this.waitUntil - now, 1000);

    if (this.pendingMove) {
      const m = this.pendingMove;
      if (this.ctx.hasReached(m.x, m.y, m.tol)) {
        this.pendingMove = null;
        this.ctx.stopMoving();
        this.current = m.resume;
        this.lastProgressAt = now;
      } else if (now > m.deadline) {
        this.pendingMove = null;
        this.ctx.stopMoving();
        this.current = m.resume;
        this.ctx.log('Move timed out, continuing', 'warn');
      } else {
        return MOVE_POLL_MS;
      }
    }

    if (this.isIdle() && this.eventQueue.length > 0) {
      const ev = this.eventQueue.shift()!;
      this.startFromEntry(ev.type === 'hotkey' ? 'Hotkey' : ev.type === 'mapChange' ? 'MapChange' : 'ReceivedMessage', ev);
    }

    this.dataMemo.clear();

    for (let step = 0; step < MAX_STEPS_PER_TICK; step++) {
      if (this.current === null) {
        const frame = this.seqStack[this.seqStack.length - 1];
        if (!frame) break;
        const node = this.nodesById.get(frame.nodeId);
        const outs = node ? this.sequenceOuts(node) : [];
        if (frame.outIndex >= outs.length) {
          this.seqStack.pop();
          continue;
        }
        const port = outs[frame.outIndex++];
        this.current = this.flowTargets.get(`${frame.nodeId}:${port}`) ?? null;
        continue;
      }

      const node = this.nodesById.get(this.current);
      if (!node) { this.current = null; continue; }
      this.activeNodeId = node.id;
      this.lastProgressAt = now;

      let result: FlowResult;
      try {
        result = this.execFlow(node);
      } catch (err) {
        this.ctx.log(`Node ${node.type} (${node.id}) failed: ${(err as Error).message}`, 'error');
        this.current = null;
        continue;
      }

      if (result.stop) { this.current = null; this.seqStack = []; break; }
      if (result.jumpTo) { this.current = this.nodesById.has(result.jumpTo) ? result.jumpTo : null; continue; }
      if (result.waitMove) {
        const resume = result.out ? this.flowTargets.get(`${node.id}:${result.out}`) ?? null : null;
        this.pendingMove = {
          x: result.waitMove.x, y: result.waitMove.y, tol: result.waitMove.tol,
          deadline: now + result.waitMove.timeoutMs, resume,
        };
        this.current = null;
        return MOVE_POLL_MS;
      }
      if (node.type === 'Sequence') {
        this.seqStack.push({ nodeId: node.id, outIndex: 0 });
        this.current = null;
        continue;
      }
      this.current = result.out ? this.flowTargets.get(`${node.id}:${result.out}`) ?? null : null;
      if (result.sleepMs && result.sleepMs > 0) {
        this.waitUntil = now + result.sleepMs;
        return Math.min(result.sleepMs, 1000);
      }
    }

    if (this.isIdle()) this.activeNodeId = null;
    return this.isIdle() ? IDLE_SLEEP_MS : 16;
  }

  private sequenceOuts(node: VisualScriptNode): string[] {
    const outs: string[] = [];
    for (const l of this.graph.links) {
      if (l.kind === 'flow' && l.from === node.id && !outs.includes(l.fromPort)) outs.push(l.fromPort);
    }
    return outs.sort();
  }

  private execFlow(node: VisualScriptNode): FlowResult {
    const impl = getNodeImpl(node.type);
    if (!impl?.run) return { out: 'out' };
    return impl.run(this.makeArgs(node));
  }

  private makeArgs(node: VisualScriptNode): ExecArgs {
    let state = this.nodeState.get(node.id);
    if (!state) { state = {}; this.nodeState.set(node.id, state); }
    return {
      node,
      param: <T,>(key: string, fallback: T): T => {
        const v = node.params[key];
        if (v === undefined || v === null || v === '') return fallback;
        if (typeof fallback === 'number') { const n = Number(v); return (Number.isFinite(n) ? n : fallback) as T; }
        if (typeof fallback === 'boolean') return (v === true || v === 'true' || v === 1) as unknown as T;
        return v as T;
      },
      input: (port: string) => this.evalInput(node.id, port, 0),
      ctx: this.ctx,
      state,
      stateOf: (nodeId: string) => {
        let s = this.nodeState.get(nodeId);
        if (!s) { s = {}; this.nodeState.set(nodeId, s); }
        return s;
      },
      event: this.activeEvent,
    };
  }

  private evalInput(nodeId: string, port: string, depth: number): unknown {
    if (depth > 32) throw new Error('data cycle');
    const src = this.dataSources.get(`${nodeId}:${port}`);
    if (!src) return undefined;
    const outputs = this.evalDataNode(src.from, depth + 1);
    return outputs[src.fromPort];
  }

  private evalDataNode(nodeId: string, depth: number): Record<string, unknown> {
    const memo = this.dataMemo.get(nodeId);
    if (memo) return memo;
    const node = this.nodesById.get(nodeId);
    if (!node) return {};
    const impl = getNodeImpl(node.type);
    if (!impl?.eval) return {};
    const args = this.makeArgs(node);
    args.input = (port: string) => this.evalInput(nodeId, port, depth);
    const outputs = impl.eval(args) ?? {};
    this.dataMemo.set(nodeId, outputs);
    return outputs;
  }

  describeState(): { activeNodeId: string | null; idle: boolean } {
    return { activeNodeId: this.activeNodeId, idle: this.isIdle() };
  }

  static validate(graph: VisualScriptGraph): string[] {
    const errors: string[] = [];
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (ids.has(n.id)) errors.push(`Duplicate node id ${n.id}`);
      ids.add(n.id);
      if (!getNodeDef(n.type)) errors.push(`Unknown node type ${n.type}`);
    }
    for (const l of graph.links) {
      if (!ids.has(l.from)) errors.push(`Link from missing node ${l.from}`);
      if (!ids.has(l.to)) errors.push(`Link to missing node ${l.to}`);
    }
    if (!graph.nodes.some(n => getNodeDef(n.type)?.category === 'entry'))
      errors.push('No entry node (add a Start node)');
    return errors;
  }
}
