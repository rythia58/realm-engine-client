import { readFileSync, watch, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PluginContext } from '../src/plugins/PluginContext.js';
import type { ClientConnection } from '../src/proxy/ClientConnection.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClassmapData {
  classes: Map<string, string>;              // obfName → parentObfName
  fields:  Map<string, Set<string>>;         // className → Set of field names
  methods: Map<string, Set<string>>;         // className → Set of method names
}

interface StatusResult {
  totalDead:  number;
  alive:      string[];                      // dead entries still in classmap (false-dead)
  unmatched:  Array<{ old: string; friendly: string }>;
  fieldOk:    Array<{ cls: string; field: string }>;
  fieldMiss:  Array<{ cls: string; field: string }>;
  methodOk:   Array<{ cls: string; method: string }>;
  methodMiss: Array<{ cls: string; method: string }>;
}

// ── Known field / method names from RuntimeOffsets / hooks ───────────────────

const WATCH_FIELDS: Record<string, string[]> = {
  KJMONHENJEN: ['CLFEOFKBNEJ', 'PKEECFNFEIO', 'HFDNHJFNEKA', 'OBAKMCCDBJA', 'MPGOFIHIDML', 'HHPOJBFICAH', 'IOKKOCEAJNA', 'KEDBLBJIKCB', 'DGNPJNFGFPE'],
  LKHPPBEGNOM: ['KJNHLADHEMH', 'NCBIICBDGAG', 'HODJPKFINKF', 'DPGEBOCBKEF', 'COHCKAPOLCA', 'ECGPFJKCCAN', 'ECHAFMAAKMD'],
  FKALGHJIADI: ['HCMECDPHEMC', 'HKPOMIBEGPK', 'FMHMGKEPIDN', 'NEDCKPIIIPN', 'DAGEMHFLJLK', 'BINDBHJLPMG', 'PPBLNMIMIFP', 'CGCMALPMMJL', 'BHJFNEAHAOE', 'GDNEBFDDDKM'],
  HJMBOMEHGDJ: ['OCLNLBHDEFK', 'DFALIKKKGLI', 'KHIHFNACEKJ', 'CIOIHEOEAEB', 'ONABHKFOJNE', 'NOJEHIAOAJM', 'IMAOBDCMPHC', 'FIAJOKGHGGK', 'HOMNPDGNOMO'],
  HBEAKBIHANL: ['HHFDCMIIIHF', 'FOMOIBCKIFP', 'FFFFKPDHEFP', 'DBNNDLKNECM'],
  CMFPKCJHKKB: ['MFEJMAABLIL', 'BMGKCKHOIOH', 'LFKLKFIEMAH', 'MCMDAGNIGEB', 'KHMCMAHEBNG', 'FNCCEGBHNKG', 'LCHPDCNHJCA', 'JKIDGAADOLC'],
};

const WATCH_METHODS: Record<string, string[]> = {
  LKHPPBEGNOM: ['ELCBJAFBLJG', 'ACCKOGJECPB'],
  HJMBOMEHGDJ: ['CGBILOJJPEI'],
  GJJCEFJMNMK: ['KOBMINBDOBD'],
};

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseMapping(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+->\s+(.+)$/);
    if (m) map.set(m[1]!.trim(), m[2]!.trim());
  }
  return map;
}

function parseClassmap(text: string): ClassmapData {
  const classes = new Map<string, string>();
  const fields  = new Map<string, Set<string>>();
  const methods = new Map<string, Set<string>>();

  let section = '';
  let curClass = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const allM    = line === '=== ALL CLASSES ===';
    const fieldsM = line.match(/^=== FIELDS:(\S+) ===$/);
    const methM   = line.match(/^=== METHODS:(\S+) ===$/);

    if (allM)    { section = 'classes'; continue; }
    if (fieldsM) { section = 'fields';  curClass = fieldsM[1]!; fields.set(curClass, new Set()); continue; }
    if (methM)   { section = 'methods'; curClass = methM[1]!;   methods.set(curClass, new Set()); continue; }
    if (line.startsWith('===')) { section = 'other'; continue; }

    if (section === 'classes') {
      const [name, parent] = line.split('\t');
      if (name && parent) classes.set(name, parent);
    } else if (section === 'fields') {
      const name = line.split('\t')[0];
      if (name) fields.get(curClass)?.add(name);
    } else if (section === 'methods') {
      const name = line.split('\t')[0];
      if (name) methods.get(curClass)?.add(name);
    }
  }

  return { classes, fields, methods };
}

// ── Status logic ──────────────────────────────────────────────────────────────

function computeStatus(
  dead: Map<string, string>,
  classmap: ClassmapData,
): StatusResult {
  const alive: string[] = [];
  const unmatched: Array<{ old: string; friendly: string }> = [];

  for (const [oldName, friendly] of dead) {
    if (classmap.classes.has(oldName)) {
      alive.push(oldName);
    } else {
      unmatched.push({ old: oldName, friendly });
    }
  }

  const fieldOk:   Array<{ cls: string; field: string }> = [];
  const fieldMiss: Array<{ cls: string; field: string }> = [];
  for (const [cls, fieldNames] of Object.entries(WATCH_FIELDS)) {
    const live = classmap.fields.get(cls);
    for (const field of fieldNames) {
      (live?.has(field) ? fieldOk : fieldMiss).push({ cls, field });
    }
  }

  const methodOk:   Array<{ cls: string; method: string }> = [];
  const methodMiss: Array<{ cls: string; method: string }> = [];
  for (const [cls, methodNames] of Object.entries(WATCH_METHODS)) {
    const live = classmap.methods.get(cls);
    for (const method of methodNames) {
      (live?.has(method) ? methodOk : methodMiss).push({ cls, method });
    }
  }

  return { totalDead: dead.size, alive, unmatched, fieldOk, fieldMiss, methodOk, methodMiss };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export function register(ctx: PluginContext): void {
  ctx.name = 'BeeByte Monitor';
  ctx.category = 'admin';

  const __dir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(__dir, '..', '..', '..', 'sandbox');

  ctx.registerSetting('classmapPath', {
    label: 'Classmap path (written by DLL on game launch)',
    type: 'text',
    value: 'C:\\Users\\Public\\re_classmap.txt',
  });

  ctx.registerSetting('deadPath', {
    label: 'beebyte-dead.txt path',
    type: 'text',
    value: resolve(workspaceRoot, 'beebyte-dead.txt'),
  });

  ctx.registerSetting('alivePath', {
    label: 'beebyte-alive.txt path',
    type: 'text',
    value: resolve(workspaceRoot, 'beebyte-alive.txt'),
  });

  // ── State ──────────────────────────────────────────────────────────────────

  let dead    = new Map<string, string>();
  let classmap: ClassmapData = { classes: new Map(), fields: new Map(), methods: new Map() };
  let lastStatus: StatusResult | null = null;
  let classmapLoaded = false;

  function loadAll(): void {
    const deadPath  = ctx.getSetting<string>('deadPath');
    const alivePath = ctx.getSetting<string>('alivePath');
    const cmPath    = ctx.getSetting<string>('classmapPath');

    try {
      if (existsSync(deadPath))  dead = parseMapping(readFileSync(deadPath, 'utf8'));
    } catch (e) { ctx.log(`dead.txt load error: ${(e as Error).message}`); }

    if (existsSync(cmPath)) {
      try {
        classmap = parseClassmap(readFileSync(cmPath, 'utf8'));
        classmapLoaded = true;
      } catch (e) { ctx.log(`classmap load error: ${(e as Error).message}`); }
    }

    if (dead.size > 0 && classmapLoaded) {
      lastStatus = computeStatus(dead, classmap);
      const s = lastStatus;
      const fieldBad  = s.fieldMiss.length;
      const methodBad = s.methodMiss.length;
      ctx.dashboardLog(
        `BeeByte scan: ${s.totalDead} dead entries — ` +
        `${s.alive.length} false-dead, ${s.unmatched.length} truly renamed | ` +
        `fields ${s.fieldOk.length}✓ ${fieldBad}✗ | ` +
        `methods ${s.methodOk.length}✓ ${methodBad}✗`
      );
    } else if (!classmapLoaded) {
      ctx.dashboardLog('BeeByte: classmap not found — launch game to generate it.');
    }
  }

  loadAll();

  // Auto-reload when DLL rewrites the classmap
  const cmPath = ctx.getSetting<string>('classmapPath');
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(cmPath, () => {
      setTimeout(() => {
        loadAll();
        ctx.dashboardLog('BeeByte: classmap reloaded (game restarted).');
      }, 500); // brief delay so DLL finishes writing
    });
  } catch { /* file may not exist yet */ }
  ctx.registerCleanup(() => watcher?.close());

  // ── Helpers ────────────────────────────────────────────────────────────────

  function notify(client: ClientConnection, msg: string): void {
    ctx.sendNotification(client, 'BeeByte', msg);
    ctx.dashboardLog(msg);
  }

  function requireStatus(client: ClientConnection): StatusResult | null {
    if (!classmapLoaded) {
      notify(client, 'No classmap yet — launch game first to generate C:\\Users\\Public\\re_classmap.txt');
      return null;
    }
    if (!lastStatus) lastStatus = computeStatus(dead, classmap);
    return lastStatus;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  ctx.hookCommand('beebyte', (client, _cmd, args) => {
    const sub = args[0]?.toLowerCase() ?? 'status';

    if (sub === 'scan') {
      loadAll();
      notify(client, 'BeeByte: reloaded from disk.');
      return;
    }

    if (sub === 'status') {
      const s = requireStatus(client);
      if (!s) return;
      notify(client, `Classes: ${s.alive.length + s.unmatched.length} dead entries checked`);
      notify(client, `  ✅ false-dead (still present): ${s.alive.length}`);
      notify(client, `  ⚠️  truly renamed (unmatched): ${s.unmatched.length}`);
      notify(client, `Fields:  ${s.fieldOk.length} OK  ${s.fieldMiss.length} missing`);
      notify(client, `Methods: ${s.methodOk.length} OK  ${s.methodMiss.length} missing`);
      if (s.fieldMiss.length > 0)  notify(client, `  Missing fields: ${s.fieldMiss.map(f => `${f.cls}.${f.field}`).join(', ')}`);
      if (s.methodMiss.length > 0) notify(client, `  Missing methods: ${s.methodMiss.map(m => `${m.cls}.${m.method}`).join(', ')}`);
      if (s.unmatched.length === 0 && s.fieldMiss.length === 0 && s.methodMiss.length === 0) {
        notify(client, '  All clear — DLL should be fully operational.');
      }
      return;
    }

    if (sub === 'dead') {
      const s = requireStatus(client);
      if (!s) return;
      if (s.unmatched.length === 0) { notify(client, 'No unmatched (truly renamed) classes.'); return; }
      notify(client, `${s.unmatched.length} unmatched entries:`);
      for (const u of s.unmatched) notify(client, `  ⚠️  ${u.old} → ${u.friendly}`);
      return;
    }

    if (sub === 'search') {
      const q = args.slice(1).join(' ').toLowerCase();
      if (!q) { notify(client, 'Usage: /beebyte search <query>'); return; }
      const results: string[] = [];
      // Search classmap classes
      for (const [name, parent] of classmap.classes) {
        if (name.toLowerCase().includes(q) || parent.toLowerCase().includes(q)) {
          results.push(`  ${name} (parent: ${parent})`);
        }
      }
      // Search dead/alive name mappings
      for (const [obf, friendly] of dead) {
        if (friendly.toLowerCase().includes(q) && !classmap.classes.has(obf)) {
          results.push(`  ⚠️  ${obf} [dead, friendly: ${friendly}]`);
        }
      }
      if (results.length === 0) { notify(client, `No results for "${q}".`); return; }
      notify(client, `Search "${q}" — ${results.length} result(s):`);
      for (const r of results.slice(0, 20)) notify(client, r);
      if (results.length > 20) notify(client, `  ... and ${results.length - 20} more`);
      return;
    }

    if (sub === 'fields') {
      const cls = args[1]?.toUpperCase();
      if (!cls) { notify(client, 'Usage: /beebyte fields <CLASS>'); return; }
      const fset = classmap.fields.get(cls);
      if (!fset) { notify(client, `No field data for ${cls} (not in classmap or DLL didn't enumerate it).`); return; }
      notify(client, `Fields on ${cls} (${fset.size} total):`);
      let i = 0;
      for (const f of fset) { notify(client, `  ${f}`); if (++i >= 30) { notify(client, '  ... (truncated)'); break; } }
      // Highlight any watch-fields that are missing
      const watch = WATCH_FIELDS[cls] ?? [];
      const missing = watch.filter(n => !fset.has(n));
      if (missing.length > 0) notify(client, `  ⚠️  Expected but missing: ${missing.join(', ')}`);
      return;
    }

    if (sub === 'methods') {
      const cls = args[1]?.toUpperCase();
      if (!cls) { notify(client, 'Usage: /beebyte methods <CLASS>'); return; }
      const mset = classmap.methods.get(cls);
      if (!mset) { notify(client, `No method data for ${cls} (not in classmap or DLL didn't enumerate it).`); return; }
      notify(client, `Obfuscated methods on ${cls} (${mset.size} total):`);
      let i = 0;
      for (const m of mset) { notify(client, `  ${m}`); if (++i >= 30) { notify(client, '  ... (truncated)'); break; } }
      const watch = WATCH_METHODS[cls] ?? [];
      const missing = watch.filter(n => !mset.has(n));
      if (missing.length > 0) notify(client, `  ⚠️  Hook methods missing: ${missing.join(', ')}`);
      return;
    }

    // Help
    notify(client, 'BeeByte Monitor commands:');
    notify(client, '  /beebyte status    — overall health summary');
    notify(client, '  /beebyte dead      — list truly renamed (unmatched) classes');
    notify(client, '  /beebyte search <q>— search classmap by name or parent');
    notify(client, '  /beebyte fields <C>— field list for a class');
    notify(client, '  /beebyte methods <C>— hook methods for a class');
    notify(client, '  /beebyte scan      — reload classmap from disk');
  });
}
