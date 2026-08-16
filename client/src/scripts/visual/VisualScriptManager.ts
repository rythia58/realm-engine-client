import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { VisualScriptGraph, VisualScriptInfo } from './VisualScriptTypes.js';
import { GraphInterpreter, type FlowEvent, type NodeContext, type Vec2 } from './GraphInterpreter.js';
import { getAllNodeDefs } from './NodeRegistry.js';
import { Logger } from '../../util/Logger.js';

interface RunningScript {
  interpreter: GraphInterpreter;
  timer: NodeJS.Timeout | null;
  error?: string;
}

export class VisualScriptManager {
  private dir: string;
  private graphs = new Map<string, VisualScriptGraph>();
  private running = new Map<string, RunningScript>();
  private savedPositions = new Map<string, Vec2>();
  private buildContext: (scriptId: string, saved: Map<string, Vec2>) => NodeContext;
  private stateNotify?: () => void;

  constructor(buildContext: (scriptId: string, saved: Map<string, Vec2>) => NodeContext) {
    this.buildContext = buildContext;
    this.dir = join(process.env.USERPROFILE || homedir(), 'Documents', 'Realmengine', 'Scripts', 'Visual');
    this.loadAll();
  }

  setStateNotify(cb?: () => void): void {
    this.stateNotify = cb;
  }

  private notify(): void {
    try { this.stateNotify?.(); } catch { /* ignore */ }
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private safeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().slice(0, 64);
  }

  loadAll(): void {
    this.ensureDir();
    this.graphs.clear();
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const graph = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as VisualScriptGraph;
        if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) continue;
        this.graphs.set(file.slice(0, -5), graph);
      } catch (err) {
        Logger.warn('VisualScripts', `Failed to load ${file}: ${(err as Error).message}`);
      }
    }
    for (const [id, graph] of this.graphs) {
      if (graph.enabled) this.start(id);
    }
  }

  list(): VisualScriptInfo[] {
    return Array.from(this.graphs.entries()).map(([id, g]) => {
      const run = this.running.get(id);
      const hotkeyNode = g.nodes.find(n => n.type === 'Hotkey' && String(n.params.key ?? '').trim());
      return {
        id,
        name: g.name || id,
        enabled: g.enabled === true,
        idleFailSafeSec: Number(g.idleFailSafeSec) || 0,
        nodeCount: g.nodes.length,
        status: run ? (run.error ? 'error' : 'running') : 'idle',
        error: run?.error,
        activeNodeId: run?.interpreter.activeNodeId ?? undefined,
        hotkey: hotkeyNode ? String(hotkeyNode.params.key).trim() : undefined,
      };
    });
  }

  get(id: string): VisualScriptGraph | undefined {
    return this.graphs.get(this.safeId(id));
  }

  save(id: string, graph: VisualScriptGraph): { ok: boolean; errors?: string[] } {
    const sid = this.safeId(id);
    if (!sid) return { ok: false, errors: ['Invalid script id'] };
    const errors = GraphInterpreter.validate(graph);
    graph.version = graph.version || '1.0';
    graph.name = String(graph.name || sid);
    graph.idleFailSafeSec = Number(graph.idleFailSafeSec) || 0;
    this.ensureDir();
    writeFileSync(join(this.dir, sid + '.json'), JSON.stringify(graph, null, 2), 'utf8');
    const wasRunning = this.running.has(sid);
    if (wasRunning) this.stop(sid);
    this.graphs.set(sid, graph);
    if (graph.enabled && errors.length === 0) this.start(sid);
    this.notify();
    return { ok: true, errors: errors.length ? errors : undefined };
  }

  remove(id: string): boolean {
    const sid = this.safeId(id);
    this.stop(sid);
    this.graphs.delete(sid);
    const path = join(this.dir, sid + '.json');
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch (err) {
      Logger.warn('VisualScripts', `Delete failed: ${(err as Error).message}`);
      return false;
    }
    this.notify();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const sid = this.safeId(id);
    const graph = this.graphs.get(sid);
    if (!graph) return false;
    graph.enabled = enabled;
    this.ensureDir();
    writeFileSync(join(this.dir, sid + '.json'), JSON.stringify(graph, null, 2), 'utf8');
    if (enabled) this.start(sid);
    else this.stop(sid);
    this.notify();
    return true;
  }

  start(id: string): boolean {
    const sid = this.safeId(id);
    if (this.running.has(sid)) return true;
    const graph = this.graphs.get(sid);
    if (!graph) return false;
    const errors = GraphInterpreter.validate(graph);
    if (errors.length) {
      Logger.warn('VisualScripts', `${sid}: not starting — ${errors.join('; ')}`);
      return false;
    }
    const ctx = this.buildContext(sid, this.savedPositions);
    const interpreter = new GraphInterpreter(graph, ctx);
    const entry: RunningScript = { interpreter, timer: null };
    this.running.set(sid, entry);
    try {
      interpreter.onStart();
    } catch (err) {
      entry.error = (err as Error).message;
      this.notify();
      return false;
    }
    const tick = () => {
      const cur = this.running.get(sid);
      if (!cur) return;
      let sleep = 250;
      try {
        const failSafe = (Number(graph.idleFailSafeSec) || 0) * 1000;
        if (failSafe > 0 && cur.interpreter.idleFor() > failSafe) {
          Logger.warn('VisualScripts', `${sid}: idle fail-safe hit, restarting flow`);
          cur.interpreter.restart();
        }
        sleep = cur.interpreter.onLoop();
      } catch (err) {
        cur.error = (err as Error).message;
        Logger.warn('VisualScripts', `${sid}: loop error — ${cur.error}`);
        this.stop(sid);
        this.notify();
        return;
      }
      if (sleep < 0) { this.stop(sid); this.notify(); return; }
      cur.timer = setTimeout(tick, Math.max(16, sleep));
    };
    entry.timer = setTimeout(tick, 16);
    Logger.log('VisualScripts', `${sid}: started`);
    this.notify();
    return true;
  }

  stop(id: string): void {
    const sid = this.safeId(id);
    const entry = this.running.get(sid);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try { entry.interpreter.onStop(); } catch { /* ignore */ }
    this.running.delete(sid);
    Logger.log('VisualScripts', `${sid}: stopped`);
  }

  stopAll(): void {
    for (const id of Array.from(this.running.keys())) this.stop(id);
  }

  postEvent(ev: FlowEvent): void {
    for (const entry of this.running.values()) entry.interpreter.postEvent(ev);
  }

  // In-game hotkeys ride the DLL pluginToggleHotkeys channel with "vs." ids.
  hotkeyBindings(): Array<{ pluginId: string; hotkey: string }> {
    const out: Array<{ pluginId: string; hotkey: string }> = [];
    for (const [id, graph] of this.graphs) {
      if (!graph.enabled) continue;
      for (const n of graph.nodes) {
        if (n.type !== 'Hotkey') continue;
        const key = String(n.params.key ?? '').trim();
        if (key) out.push({ pluginId: `vs.${id}.${n.id}`, hotkey: key });
      }
    }
    return out;
  }

  handleHotkeyEvent(pluginId: string): boolean {
    if (!pluginId.startsWith('vs.')) return false;
    const parts = pluginId.split('.');
    const scriptId = parts[1];
    const nodeId = parts[2];
    const graph = this.graphs.get(scriptId);
    const node = graph?.nodes.find(n => n.id === nodeId);
    const key = String(node?.params.key ?? '').trim();
    if (key) this.postEvent({ type: 'hotkey', payload: { key } });
    return true;
  }

  nodeDefsForEditor(): unknown[] {
    return getAllNodeDefs();
  }

  // Compact pipe-delimited wire format for the in-game editor (no JSON parsing in C++).
  defsToDllText(): string {
    const e = encodeURIComponent;
    return getAllNodeDefs().map(d =>
      ['D', d.type, e(d.label), d.category,
        d.inputs.map(p => `${p.name}:${p.type}`).join(','),
        d.outputs.map(p => `${p.name}:${p.type}`).join(','),
        d.params.map(p => [p.key, e(p.label), p.type, e(String(p.value ?? '')), (p.options ?? []).join(',')].join('~')).join(';'),
        e(d.description ?? ''),
      ].join('|')).join('\n');
  }

  toDllText(graph: VisualScriptGraph): string {
    const e = encodeURIComponent;
    const lines = [
      ['M', e(graph.name), graph.enabled ? '1' : '0', String(Number(graph.idleFailSafeSec) || 0)].join('|'),
    ];
    for (const n of graph.nodes) {
      const params = Object.entries(n.params ?? {}).map(([k, v]) => `${e(k)}=${e(String(v ?? ''))}`).join('&');
      lines.push(['N', n.id, n.type, String(Math.round(n.x)), String(Math.round(n.y)), params].join('|'));
    }
    for (const l of graph.links) {
      lines.push(['L', l.from, l.fromPort, l.to, l.toPort, l.kind].join('|'));
    }
    return lines.join('\n');
  }

  fromDllText(text: string): VisualScriptGraph {
    const d = decodeURIComponent;
    const graph: VisualScriptGraph = { version: '1.0', name: '', enabled: false, idleFailSafeSec: 0, nodes: [], links: [] };
    for (const line of text.split('\n')) {
      const f = line.split('|');
      if (f[0] === 'M') {
        graph.name = d(f[1] ?? '');
        graph.enabled = f[2] === '1';
        graph.idleFailSafeSec = Number(f[3]) || 0;
      } else if (f[0] === 'N') {
        const params: Record<string, unknown> = {};
        for (const kv of (f[5] ?? '').split('&')) {
          if (!kv) continue;
          const eq = kv.indexOf('=');
          if (eq > 0) params[d(kv.slice(0, eq))] = d(kv.slice(eq + 1));
        }
        graph.nodes.push({ id: f[1], type: f[2], x: Number(f[3]) || 0, y: Number(f[4]) || 0, params });
      } else if (f[0] === 'L') {
        graph.links.push({ from: f[1], fromPort: f[2], to: f[3], toPort: f[4], kind: f[5] === 'data' ? 'data' : 'flow' });
      }
    }
    return graph;
  }

  liveState(): Array<{ id: string; activeNodeId: string | null; idle: boolean }> {
    return Array.from(this.running.entries()).map(([id, r]) => ({
      id,
      ...r.interpreter.describeState(),
    }));
  }
}
