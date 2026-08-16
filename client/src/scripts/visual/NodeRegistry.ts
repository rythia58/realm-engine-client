import type { NodeDef } from './VisualScriptTypes.js';
import type { ExecArgs, FlowResult, Vec2 } from './GraphInterpreter.js';

export interface NodeImpl {
  run?: (args: ExecArgs) => FlowResult;
  eval?: (args: ExecArgs) => Record<string, unknown>;
}

interface RegistryEntry { def: NodeDef; impl: NodeImpl; }

const registry = new Map<string, RegistryEntry>();

function register(def: NodeDef, impl: NodeImpl): void {
  registry.set(def.type, { def, impl });
}

export function getNodeDef(type: string): NodeDef | undefined {
  return registry.get(type)?.def;
}

export function getNodeImpl(type: string): NodeImpl | undefined {
  return registry.get(type)?.impl;
}

export function getAllNodeDefs(): NodeDef[] {
  return Array.from(registry.values()).map(e => e.def);
}

function asVec2(v: unknown): Vec2 | null {
  if (v && typeof v === 'object' && typeof (v as Vec2).x === 'number' && typeof (v as Vec2).y === 'number') return v as Vec2;
  return null;
}

const flowIn = { name: 'in', type: 'flow' as const };
const flowOut = { name: 'out', type: 'flow' as const };

// ── Entry ────────────────────────────────────────────────────────────────

register({
  type: 'Start', label: 'Start', category: 'entry',
  inputs: [], outputs: [flowOut], params: [],
  description: 'Runs when the script is enabled.',
}, {
  run: () => ({ out: 'out' }),
});

register({
  type: 'Hotkey', label: 'Hotkey', category: 'entry',
  inputs: [], outputs: [flowOut],
  params: [{ key: 'key', label: 'Key', type: 'text', value: 'F6' }],
  description: 'Runs when the hotkey is pressed in the dashboard/overlay.',
}, {
  run: () => ({ out: 'out' }),
});

register({
  type: 'MapChange', label: 'Map Change', category: 'entry',
  inputs: [], outputs: [flowOut],
  params: [{ key: 'mapContains', label: 'Map name contains', type: 'text', value: '' }],
  description: 'Runs when the map changes (empty filter = any map).',
}, {
  run: () => ({ out: 'out' }),
});

register({
  type: 'ReceivedMessage', label: 'Received Message', category: 'entry',
  inputs: [], outputs: [flowOut, { name: 'text', type: 'string' }, { name: 'sender', type: 'string' }],
  params: [{ key: 'contains', label: 'Text contains', type: 'text', value: '' }],
  description: 'Runs when a chat message matching the filter arrives.',
}, {
  run: () => ({ out: 'out' }),
  eval: ({ event }) => ({
    text: String(event?.payload.text ?? ''),
    sender: String(event?.payload.sender ?? ''),
  }),
});

// ── Control ──────────────────────────────────────────────────────────────

register({
  type: 'Sequence', label: 'Sequence', category: 'control',
  inputs: [flowIn],
  outputs: [
    { name: 'out1', type: 'flow' }, { name: 'out2', type: 'flow' },
    { name: 'out3', type: 'flow' }, { name: 'out4', type: 'flow' },
  ],
  params: [],
  description: 'Fires each connected output in order.',
}, {
  run: () => ({}),
});

register({
  type: 'If', label: 'If', category: 'control',
  inputs: [flowIn, { name: 'condition', type: 'boolean' }],
  outputs: [{ name: 'true', type: 'flow' }, { name: 'false', type: 'flow' }],
  params: [],
}, {
  run: ({ input }) => ({ out: input('condition') ? 'true' : 'false' }),
});

register({
  type: 'Wait', label: 'Wait', category: 'control',
  inputs: [flowIn], outputs: [flowOut],
  params: [{ key: 'ms', label: 'Milliseconds', type: 'number', value: 1000, min: 0, step: 100 }],
}, {
  run: ({ param }) => ({ out: 'out', sleepMs: param('ms', 1000) }),
});

register({
  type: 'PushNode', label: 'Push Node', category: 'control',
  inputs: [flowIn], outputs: [],
  params: [{ key: 'target', label: 'Target node id', type: 'text', value: '' }],
  description: 'Jumps flow to another node — use for loops and state transitions.',
}, {
  run: ({ param }) => {
    const target = param('target', '');
    return target ? { jumpTo: target } : {};
  },
});

register({
  type: 'Stop', label: 'Stop', category: 'control',
  inputs: [flowIn], outputs: [], params: [],
  description: 'Ends the current flow.',
}, {
  run: () => ({ stop: true }),
});

// ── Data ─────────────────────────────────────────────────────────────────

register({
  type: 'Point', label: 'Point', category: 'data',
  inputs: [], outputs: [{ name: 'pos', type: 'position' }],
  params: [
    { key: 'x', label: 'X', type: 'number', value: 0, step: 0.5 },
    { key: 'y', label: 'Y', type: 'number', value: 0, step: 0.5 },
  ],
}, {
  eval: ({ param }) => ({ pos: { x: param('x', 0), y: param('y', 0) } }),
});

register({
  type: 'PointList', label: 'Point List', category: 'data',
  inputs: [], outputs: [{ name: 'point', type: 'position' }, { name: 'count', type: 'number' }],
  params: [{ key: 'points', label: 'Points (x,y; x,y; ...)', type: 'text', value: '' }],
  description: 'Current point of a list — advance with Next Point.',
}, {
  eval: ({ param, state }) => {
    const pts: Vec2[] = [];
    for (const token of param('points', '').split(';')) {
      const [xs, ys] = token.split(',');
      const x = Number(xs), y = Number(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    const idx = typeof state.idx === 'number' ? state.idx : 0;
    return { point: pts.length ? pts[idx % pts.length] : null, count: pts.length };
  },
});

register({
  type: 'NextPoint', label: 'Next Point', category: 'control',
  inputs: [flowIn], outputs: [flowOut],
  params: [{ key: 'listNode', label: 'Point List node id', type: 'text', value: '' }],
  description: 'Advances a Point List to its next point.',
}, {
  run: ({ param, stateOf }) => {
    const target = param('listNode', '');
    if (target) {
      const s = stateOf(target);
      s.idx = (typeof s.idx === 'number' ? s.idx : 0) + 1;
    }
    return { out: 'out' };
  },
});

register({
  type: 'OffsetPos', label: 'Offset Pos', category: 'data',
  inputs: [{ name: 'pos', type: 'position' }],
  outputs: [{ name: 'pos', type: 'position' }],
  params: [
    { key: 'dx', label: 'ΔX', type: 'number', value: 0, step: 0.5 },
    { key: 'dy', label: 'ΔY', type: 'number', value: 0, step: 0.5 },
  ],
}, {
  eval: ({ input, param }) => {
    const p = asVec2(input('pos'));
    return { pos: p ? { x: p.x + param('dx', 0), y: p.y + param('dy', 0) } : null };
  },
});

register({
  type: 'Vec2Operator', label: 'Vec2 Operator', category: 'data',
  inputs: [{ name: 'a', type: 'position' }, { name: 'b', type: 'position' }],
  outputs: [{ name: 'pos', type: 'position' }, { name: 'value', type: 'number' }],
  params: [{ key: 'op', label: 'Operation', type: 'select', value: 'add', options: ['add', 'subtract', 'midpoint', 'distance'] }],
}, {
  eval: ({ input, param }) => {
    const a = asVec2(input('a'));
    const b = asVec2(input('b'));
    if (!a || !b) return { pos: null, value: 0 };
    switch (String(param('op', 'add'))) {
      case 'subtract': return { pos: { x: a.x - b.x, y: a.y - b.y }, value: 0 };
      case 'midpoint': return { pos: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, value: 0 };
      case 'distance': return { pos: null, value: Math.hypot(a.x - b.x, a.y - b.y) };
      default: return { pos: { x: a.x + b.x, y: a.y + b.y }, value: 0 };
    }
  },
});

register({
  type: 'PlayerPos', label: 'Player Position', category: 'data',
  inputs: [], outputs: [{ name: 'pos', type: 'position' }], params: [],
}, {
  eval: ({ ctx }) => ({ pos: ctx.getPlayerPos() }),
});

register({
  type: 'PlayerCount', label: 'Player Count', category: 'data',
  inputs: [], outputs: [{ name: 'count', type: 'number' }],
  params: [{ key: 'radius', label: 'Radius (0 = whole map)', type: 'number', value: 0, min: 0 }],
}, {
  eval: ({ ctx, param }) => ({ count: ctx.playerCount(param('radius', 0)) }),
});

register({
  type: 'StatusLevel', label: 'Status / Level', category: 'data',
  inputs: [],
  outputs: [
    { name: 'hp', type: 'number' }, { name: 'hpPct', type: 'number' },
    { name: 'mp', type: 'number' }, { name: 'mpPct', type: 'number' },
    { name: 'level', type: 'number' }, { name: 'hasEffect', type: 'boolean' },
  ],
  params: [{ key: 'effect', label: 'Effect name (for hasEffect)', type: 'text', value: '' }],
}, {
  eval: ({ ctx, param }) => {
    const s = ctx.getPlayerStats();
    return {
      hp: s?.hp ?? 0,
      hpPct: s && s.maxHp > 0 ? (s.hp / s.maxHp) * 100 : 0,
      mp: s?.mp ?? 0,
      mpPct: s && s.maxMp > 0 ? (s.mp / s.maxMp) * 100 : 0,
      level: s?.level ?? 0,
      hasEffect: param('effect', '') ? ctx.hasEffect(param('effect', '')) : false,
    };
  },
});

register({
  type: 'ObjectList', label: 'Object List', category: 'data',
  inputs: [{ name: 'index', type: 'number' }],
  outputs: [
    { name: 'count', type: 'number' },
    { name: 'nearestPos', type: 'position' },
    { name: 'nearestId', type: 'number' },
    { name: 'found', type: 'boolean' },
  ],
  params: [
    { key: 'filter', label: 'Name contains (portal / enemy / beacon / name)', type: 'text', value: 'portal' },
    { key: 'radius', label: 'Radius', type: 'number', value: 15, min: 1 },
    { key: 'order', label: 'Order', type: 'select', value: 'distance', options: ['distance', 'id'] },
  ],
  description: 'Picks a matching object. Link "index" to walk the list (wraps); "id" order stays stable as you move.',
}, {
  eval: ({ ctx, param, input }) => {
    const list = ctx.listObjects(param('filter', ''), param('radius', 15));
    if (String(param('order', 'distance')) === 'id') list.sort((a, b) => a.id - b.id);

    const rawIdx = input('index');
    const idx = rawIdx === undefined || rawIdx === null ? 0 : Math.trunc(Number(rawIdx));
    const pick = list.length
      ? list[((idx % list.length) + list.length) % list.length]
      : undefined;

    return {
      count: list.length,
      nearestPos: pick ? { x: pick.x, y: pick.y } : null,
      nearestId: pick?.id ?? -1,
      found: list.length > 0,
    };
  },
});

register({
  type: 'Comparison', label: 'Comparison', category: 'data',
  inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
  outputs: [{ name: 'result', type: 'boolean' }],
  params: [
    { key: 'op', label: 'Operator', type: 'select', value: '<', options: ['<', '<=', '>', '>=', '==', '!='] },
    { key: 'bConst', label: 'B (if not linked)', type: 'number', value: 0 },
  ],
}, {
  eval: ({ input, param }) => {
    const a = Number(input('a') ?? 0);
    const bLinked = input('b');
    const b = bLinked === undefined ? param('bConst', 0) : Number(bLinked);
    switch (String(param('op', '<'))) {
      case '<': return { result: a < b };
      case '<=': return { result: a <= b };
      case '>': return { result: a > b };
      case '>=': return { result: a >= b };
      case '!=': return { result: a !== b };
      default: return { result: a === b };
    }
  },
});

register({
  type: 'SavedPosition', label: 'Saved Position', category: 'data',
  inputs: [], outputs: [{ name: 'pos', type: 'position' }],
  params: [{ key: 'slot', label: 'Slot name', type: 'text', value: 'a' }],
}, {
  eval: ({ ctx, param }) => ({ pos: ctx.getSavedPosition(param('slot', 'a')) }),
});

// ── Actions ──────────────────────────────────────────────────────────────

register({
  type: 'MoveTo', label: 'Move To', category: 'action',
  inputs: [flowIn, { name: 'position', type: 'position' }],
  outputs: [flowOut],
  params: [
    { key: 'tolerance', label: 'Arrive tolerance (tiles)', type: 'number', value: 1, min: 0.2, step: 0.1 },
    { key: 'untilReached', label: 'Wait until reached', type: 'boolean', value: true },
    { key: 'timeoutSec', label: 'Timeout (sec)', type: 'number', value: 30, min: 1 },
  ],
}, {
  run: ({ input, param, ctx }) => {
    const p = asVec2(input('position'));
    if (!p) { ctx.log('MoveTo: no position input', 'warn'); return { out: 'out' }; }
    ctx.moveTo(p.x, p.y);
    if (!param('untilReached', true)) return { out: 'out' };
    return { out: 'out', waitMove: { x: p.x, y: p.y, tol: param('tolerance', 1), timeoutMs: param('timeoutSec', 30) * 1000 } };
  },
});

register({
  type: 'ConnectToQuest', label: 'Connect to Quest', category: 'action',
  inputs: [flowIn], outputs: [flowOut, { name: 'noQuest', type: 'flow' }],
  params: [
    { key: 'tolerance', label: 'Arrive tolerance (tiles)', type: 'number', value: 3, min: 0.5, step: 0.5 },
    { key: 'timeoutSec', label: 'Timeout (sec)', type: 'number', value: 60, min: 1 },
  ],
  description: 'Walks to the current quest target.',
}, {
  run: ({ ctx, param }) => {
    const q = ctx.questTarget();
    if (!q) return { out: 'noQuest' };
    ctx.moveTo(q.x, q.y);
    return { out: 'out', waitMove: { x: q.x, y: q.y, tol: param('tolerance', 3), timeoutMs: param('timeoutSec', 60) * 1000 } };
  },
});

register({
  type: 'EnterPortal', label: 'Enter Portal', category: 'action',
  inputs: [flowIn, { name: 'portalId', type: 'number' }],
  outputs: [flowOut, { name: 'failed', type: 'flow' }],
  params: [],
  description: 'Uses the given portal id, or the nearest portal if unlinked.',
}, {
  run: ({ input, ctx }) => {
    const raw = input('portalId');
    const id = raw === undefined || raw === null ? undefined : Number(raw);
    const ok = ctx.enterPortal(id !== undefined && id >= 0 ? id : undefined);
    return { out: ok ? 'out' : 'failed' };
  },
});

register({
  type: 'UseItem', label: 'Use Item', category: 'action',
  inputs: [flowIn], outputs: [flowOut, { name: 'failed', type: 'flow' }],
  params: [{ key: 'slot', label: 'Inventory slot (0-3 equip, 4-11 inv)', type: 'number', value: 4, min: 0, max: 19 }],
}, {
  run: ({ ctx, param }) => ({ out: ctx.useItem(param('slot', 4)) ? 'out' : 'failed' }),
});

register({
  type: 'SendMessage', label: 'Send Message', category: 'action',
  inputs: [flowIn, { name: 'text', type: 'string' }], outputs: [flowOut],
  params: [{ key: 'text', label: 'Text (if not linked)', type: 'text', value: '' }],
}, {
  run: ({ input, param, ctx }) => {
    const linked = input('text');
    const text = linked === undefined ? param('text', '') : String(linked);
    if (text) ctx.sendChat(text);
    return { out: 'out' };
  },
});

register({
  type: 'Nexus', label: 'Nexus', category: 'action',
  inputs: [flowIn], outputs: [flowOut], params: [],
}, {
  run: ({ ctx }) => { ctx.nexus(); return { out: 'out' }; },
});

register({
  type: 'SavePosition', label: 'Save Position', category: 'action',
  inputs: [flowIn], outputs: [flowOut],
  params: [{ key: 'slot', label: 'Slot name', type: 'text', value: 'a' }],
  description: 'Snapshots current player position into a named slot (read with Saved Position).',
}, {
  run: ({ ctx, param }) => {
    const pos = ctx.getPlayerPos();
    if (pos) ctx.savePosition(param('slot', 'a'), pos);
    return { out: 'out' };
  },
});

register({
  type: 'ResetTileCache', label: 'Reset Tile Cache', category: 'action',
  inputs: [flowIn], outputs: [flowOut], params: [],
}, {
  run: ({ ctx }) => { ctx.resetTileCache(); return { out: 'out' }; },
});

register({
  type: 'MathOperator', label: 'Math Operator', category: 'data',
  inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
  outputs: [{ name: 'value', type: 'number' }],
  params: [
    { key: 'op', label: 'Operation', type: 'select', value: 'add', options: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'mod'] },
    { key: 'bConst', label: 'B (if not linked)', type: 'number', value: 0 },
  ],
}, {
  eval: ({ input, param }) => {
    const a = Number(input('a') ?? 0);
    const bLinked = input('b');
    const b = bLinked === undefined ? param('bConst', 0) : Number(bLinked);
    switch (String(param('op', 'add'))) {
      case 'subtract': return { value: a - b };
      case 'multiply': return { value: a * b };
      case 'divide': return { value: b !== 0 ? a / b : 0 };
      case 'min': return { value: Math.min(a, b) };
      case 'max': return { value: Math.max(a, b) };
      case 'mod': return { value: b !== 0 ? a % b : 0 };
      default: return { value: a + b };
    }
  },
});

register({
  type: 'LogicOperator', label: 'Logic Operator', category: 'data',
  inputs: [{ name: 'a', type: 'boolean' }, { name: 'b', type: 'boolean' }],
  outputs: [{ name: 'result', type: 'boolean' }],
  params: [{ key: 'op', label: 'Operation', type: 'select', value: 'and', options: ['and', 'or', 'not', 'xor'] }],
}, {
  eval: ({ input, param }) => {
    const a = input('a') === true;
    const b = input('b') === true;
    switch (String(param('op', 'and'))) {
      case 'or': return { result: a || b };
      case 'not': return { result: !a };
      case 'xor': return { result: a !== b };
      default: return { result: a && b };
    }
  },
});

register({
  type: 'RandomNumber', label: 'Random Number', category: 'data',
  inputs: [], outputs: [{ name: 'value', type: 'number' }],
  params: [
    { key: 'min', label: 'Min', type: 'number', value: 0 },
    { key: 'max', label: 'Max', type: 'number', value: 100 },
  ],
}, {
  eval: ({ param }) => {
    const lo = param('min', 0), hi = param('max', 100);
    return { value: lo + Math.random() * (hi - lo) };
  },
});

register({
  type: 'RandomPoint', label: 'Random Point', category: 'data',
  inputs: [{ name: 'center', type: 'position' }],
  outputs: [{ name: 'pos', type: 'position' }],
  params: [{ key: 'radius', label: 'Radius', type: 'number', value: 3, min: 0.5, step: 0.5 }],
}, {
  eval: ({ input, param, ctx }) => {
    const c = asVec2(input('center')) ?? ctx.getPlayerPos();
    if (!c) return { pos: null };
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * param('radius', 3);
    return { pos: { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r } };
  },
});

register({
  type: 'Cooldown', label: 'Cooldown', category: 'control',
  inputs: [flowIn],
  outputs: [flowOut, { name: 'blocked', type: 'flow' }],
  params: [{ key: 'ms', label: 'Cooldown (ms)', type: 'number', value: 5000, min: 100, step: 100 }],
  description: 'Passes flow at most once per cooldown window.',
}, {
  run: ({ param, state }) => {
    const now = Date.now();
    const last = typeof state.last === 'number' ? state.last : 0;
    if (now - last < param('ms', 5000)) return { out: 'blocked' };
    state.last = now;
    return { out: 'out' };
  },
});

register({
  type: 'Counter', label: 'Counter', category: 'control',
  inputs: [flowIn],
  outputs: [flowOut, { name: 'reached', type: 'flow' }, { name: 'count', type: 'number' }],
  params: [{ key: 'target', label: 'Target count (0 = never)', type: 'number', value: 0, min: 0 }],
  description: 'Counts passes; fires "reached" instead of "out" when target is hit, then resets.',
}, {
  run: ({ param, state }) => {
    const count = (typeof state.count === 'number' ? state.count : 0) + 1;
    state.count = count;
    const target = param('target', 0);
    if (target > 0 && count >= target) { state.count = 0; return { out: 'reached' }; }
    return { out: 'out' };
  },
  eval: ({ state }) => ({ count: typeof state.count === 'number' ? state.count : 0 }),
});

register({
  type: 'GroupPlayers', label: 'Group Players', category: 'data',
  inputs: [],
  outputs: [{ name: 'center', type: 'position' }, { name: 'count', type: 'number' }],
  params: [{ key: 'maxDistance', label: 'Max distance', type: 'number', value: 15, min: 1 }],
  description: 'Center of the largest nearby player cluster.',
}, {
  eval: ({ ctx, param }) => {
    const players = ctx.listPlayers();
    const maxDist = param('maxDistance', 15);
    let best: { x: number; y: number; n: number } | null = null;
    for (const p of players) {
      const near = players.filter(q => Math.hypot(q.x - p.x, q.y - p.y) <= maxDist);
      if (!best || near.length > best.n) {
        best = {
          x: near.reduce((s, q) => s + q.x, 0) / near.length,
          y: near.reduce((s, q) => s + q.y, 0) / near.length,
          n: near.length,
        };
      }
    }
    return { center: best ? { x: best.x, y: best.y } : null, count: best?.n ?? 0 };
  },
});

register({
  type: 'QuestTarget', label: 'Quest Target', category: 'data',
  inputs: [],
  outputs: [{ name: 'id', type: 'number' }, { name: 'pos', type: 'position' }, { name: 'found', type: 'boolean' }],
  params: [],
  description: 'The server quest marker — in realms this is the active beacon.',
}, {
  eval: ({ ctx }) => {
    const q = ctx.questTarget();
    return { id: q?.id ?? -1, pos: q ? { x: q.x, y: q.y } : null, found: !!q };
  },
});

register({
  type: 'TeleportToBeacon', label: 'Teleport to Beacon', category: 'action',
  inputs: [flowIn, { name: 'beaconId', type: 'number' }],
  outputs: [flowOut, { name: 'failed', type: 'flow' }],
  params: [],
  description: 'Teleports to a beacon (or any entity) by object id. Fails if teleport is blocked here.',
}, {
  run: ({ input, ctx }) => {
    const raw = input('beaconId');
    const id = raw === undefined || raw === null ? -1 : Number(raw);
    if (!Number.isFinite(id) || id < 0) return { out: 'failed' };
    return { out: ctx.teleportToBeacon(id) ? 'out' : 'failed' };
  },
});

register({
  type: 'TeleportToPlayer', label: 'Teleport to Player', category: 'action',
  inputs: [flowIn, { name: 'name', type: 'string' }],
  outputs: [flowOut, { name: 'failed', type: 'flow' }],
  params: [{ key: 'name', label: 'Player name (if not linked)', type: 'text', value: '' }],
}, {
  run: ({ input, param, ctx }) => {
    const linked = input('name');
    const name = linked === undefined ? param('name', '') : String(linked);
    if (!name) return { out: 'failed' };
    return { out: ctx.teleportToPlayer(name) ? 'out' : 'failed' };
  },
});

register({
  type: 'PluginToggle', label: 'Plugin Toggle', category: 'action',
  inputs: [flowIn], outputs: [flowOut, { name: 'failed', type: 'flow' }],
  params: [
    { key: 'pluginId', label: 'Plugin id (e.g. auto-loot)', type: 'text', value: '' },
    { key: 'enabled', label: 'Enable', type: 'boolean', value: true },
  ],
  description: 'Turns a client plugin on or off.',
}, {
  run: ({ param, ctx }) => {
    const id = param('pluginId', '');
    if (!id) return { out: 'failed' };
    return { out: ctx.setPluginEnabled(id, param('enabled', true)) ? 'out' : 'failed' };
  },
});

register({
  type: 'DllFeature', label: 'DLL Feature', category: 'action',
  inputs: [flowIn], outputs: [flowOut],
  params: [
    { key: 'key', label: 'Feature key (e.g. autoAimEnabled)', type: 'text', value: '' },
    { key: 'value', label: 'Value (true/false/number/text)', type: 'text', value: 'true' },
  ],
  description: 'Sends a raw feature command to the DLL. Power-user node.',
}, {
  run: ({ param, ctx }) => {
    const key = param('key', '');
    if (key) {
      const raw = param('value', 'true');
      const value: boolean | number | string =
        raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
      ctx.setDllFeature(key, value);
    }
    return { out: 'out' };
  },
});

register({
  type: 'Notify', label: 'Notify', category: 'action',
  inputs: [flowIn, { name: 'text', type: 'string' }], outputs: [flowOut],
  params: [{ key: 'text', label: 'Text (if not linked)', type: 'text', value: '' }],
  description: 'Shows floating text in-game.',
}, {
  run: ({ input, param, ctx }) => {
    const linked = input('text');
    const text = linked === undefined ? param('text', '') : String(linked);
    if (text) ctx.notify(text);
    return { out: 'out' };
  },
});

register({
  type: 'Log', label: 'Log', category: 'action',
  inputs: [flowIn, { name: 'value', type: 'any' }], outputs: [flowOut],
  params: [{ key: 'text', label: 'Text', type: 'text', value: '' }],
}, {
  run: ({ input, param, ctx }) => {
    const v = input('value');
    ctx.log(param('text', '') + (v !== undefined ? ' ' + JSON.stringify(v) : ''));
    return { out: 'out' };
  },
});
