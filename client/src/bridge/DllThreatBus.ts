export interface DllGroundEvent {
  rawDamage: number;
  tHitMs: number;
}

export interface DllGround {
  rawDamage: number;
  tHitMs: number;
  events: DllGroundEvent[];
}

export interface DllThreat {
  attackerObjId: number;
  /** ENEMYSHOOT keys bullets by ownerId, which is not always attackerObjId. */
  ownerObjId: number;
  bulletId: number;
  tHitMs: number;
  fallbackDamage: number;
  fallbackArmorPiercing: boolean;
}

const GLOBAL_SLOT_KEY = '__LFG_dllThreatBus_v1';

type BusSlot = { threats: DllThreat[]; ground: DllGround; at: number };

function getBusSlot(): BusSlot {
  const g = globalThis as unknown as Record<string, unknown>;
  let slot = g[GLOBAL_SLOT_KEY] as BusSlot | undefined;
  if (!slot) {
    slot = { threats: [], ground: { rawDamage: 0, tHitMs: -1, events: [] }, at: 0 };
    g[GLOBAL_SLOT_KEY] = slot;
  }
  return slot;
}

export function publishDllThreats(
  threats: DllThreat[],
  ground: DllGround = { rawDamage: 0, tHitMs: -1, events: [] },
): void {
  const slot = getBusSlot();
  slot.threats = threats;
  slot.ground = ground;
  slot.at = Date.now();
}

export function getDllThreats(maxAgeMs = 500): DllThreat[] {
  const slot = getBusSlot();
  if (slot.at === 0 || Date.now() - slot.at > maxAgeMs) return [];
  return slot.threats;
}

export function getDllGround(maxAgeMs = 500): DllGround | null {
  const slot = getBusSlot();
  if (slot.at === 0 || Date.now() - slot.at > maxAgeMs) return null;
  return slot.ground;
}

export function getDllThreatsAgeMs(): number | null {
  const slot = getBusSlot();
  return slot.at === 0 ? null : Date.now() - slot.at;
}

/** `attacker:bullet:tHitMs:damage:pierce:owner` */
export function parseThreatPayload(payload: string): { threats: DllThreat[]; ground: DllGround } {
  const out: DllThreat[] = [];
  const ground: DllGround = { rawDamage: 0, tHitMs: -1, events: [] };
  if (!payload) return { threats: out, ground };

  // "<groundDmg>:<groundTHitMs>;<entries>".
  let entriesPart = payload;
  const semi = payload.indexOf(';');
  if (semi >= 0) {
    // Segment 0 is the summary and repeats events[0]; counting it as an event
    // double-charged the first ground tick.
    const segments = payload.slice(0, semi).split('|');
    for (let i = 0; i < segments.length; i++) {
      const g = segments[i].split(':');
      if (g.length !== 2) continue;
      const dmg = Number(g[0]);
      const t = Number(g[1]);
      if (!Number.isFinite(dmg) || !Number.isFinite(t)) continue;
      if (i === 0) {
        ground.rawDamage = dmg;
        ground.tHitMs = t;
        continue;
      }
      if (dmg > 0) ground.events.push({ rawDamage: dmg, tHitMs: t });
    }
  }
  if (semi >= 0) entriesPart = payload.slice(semi + 1);

  if (!entriesPart) return { threats: out, ground };
  for (const entry of entriesPart.split(',')) {
    const parts = entry.split(':');
    // Older DLL builds omit the trailing owner id.
    if (parts.length !== 5 && parts.length !== 6) continue;
    const attackerObjId = Number(parts[0]);
    const bulletId = Number(parts[1]);
    const tHitMs = Number(parts[2]);
    const fallbackDamage = Number(parts[3]);
    if (!Number.isFinite(attackerObjId) || !Number.isFinite(bulletId)
      || !Number.isFinite(tHitMs) || !Number.isFinite(fallbackDamage)) continue;
    const ownerRaw = parts.length === 6 ? Number(parts[5]) : NaN;
    out.push({
      attackerObjId,
      ownerObjId: Number.isFinite(ownerRaw) ? ownerRaw : attackerObjId,
      bulletId,
      tHitMs,
      fallbackDamage,
      fallbackArmorPiercing: parts[4] === '1',
    });
  }
  return { threats: out, ground };
}
