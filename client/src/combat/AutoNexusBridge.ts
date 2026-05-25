/**
 * AutoNexus packet→DLL bridge (Phase 2 of the xrDriver AutoNexus port).
 *
 * Mirrors xrDriver's `AutoNexus::onPlayerHit / onAoeAck / ProcessStatus`
 * but at the proxy layer — packet IDs and field offsets come from
 * `data/packet-definitions.json`, so there's zero IL2CPP method resolution
 * to break across game updates.
 *
 * Wire format to the DLL (via DllFeatureBus → IpcBridge):
 *   key="autonexusOnDamage" value="<dmg>,<silent>"   (silent: 0|1)
 *   key="autonexusSyncHp"   value="<hp>,<maxHp>"
 *
 * DLL side: see internal/src/ui/IpcBridge.cpp dispatch + AutoNexus::
 *   OnExternalDamage(dmg, silent) / OnExternalHpSync(hp, maxHp).
 */
import type { Proxy } from '../proxy/Proxy.js';
import type { ProjectileTracker } from '../state/ProjectileTracker.js';
import { sendDllFeature } from '../bridge/DllFeatureBus.js';

const STAT_TYPE_MAXHP = 0;
const STAT_TYPE_HP    = 1;

interface RecentAoe {
  /** Packet position.x */
  x: number;
  /** Packet position.y */
  y: number;
  /** Damage from the incoming AOE packet — possibly armor-pierce. */
  damage: number;
  /** ms timestamp when seen — short TTL prevents stale-match against old AOEs. */
  seenAt: number;
}
const AOE_MATCH_TTL_MS = 1500;
const AOE_POS_EPSILON  = 0.01;

export function installAutoNexusBridge(
  proxy: Proxy,
  projectileTracker: ProjectileTracker,
): void {
  // ── AOE damage cache: AOE incoming first, then AOEACK outgoing.
  // Match by position+TTL since AOEACK only carries position (no damage).
  const recentAoes: RecentAoe[] = [];
  function rememberAoe(x: number, y: number, damage: number): void {
    const now = Date.now();
    // Drop expired entries opportunistically.
    while (recentAoes.length && now - recentAoes[0].seenAt > AOE_MATCH_TTL_MS) {
      recentAoes.shift();
    }
    recentAoes.push({ x, y, damage, seenAt: now });
  }
  function consumeAoeAt(x: number, y: number): number {
    const now = Date.now();
    for (let i = recentAoes.length - 1; i >= 0; i--) {
      const r = recentAoes[i];
      if (now - r.seenAt > AOE_MATCH_TTL_MS) {
        recentAoes.splice(i, 1);
        continue;
      }
      if (Math.abs(r.x - x) < AOE_POS_EPSILON && Math.abs(r.y - y) < AOE_POS_EPSILON) {
        recentAoes.splice(i, 1);
        return r.damage;
      }
    }
    return 0;
  }

  // Incoming AOE — record the damage so the matching outgoing AOEACK can
  // attribute it to the player.
  proxy.hookPacket('AOE', (_client, packet) => {
    const data = packet.data ?? packet;
    const pos = data.position as { x: number; y: number } | undefined;
    const dmg = Number(data.damage ?? 0);
    if (!pos || !Number.isFinite(dmg) || dmg <= 0) return;
    rememberAoe(pos.x, pos.y, dmg);
  });

  // Outgoing PLAYERHIT — the client confirms taking a bullet. Look up the
  // bullet's damage via the projectile tracker (keyed by ownerId:bulletId).
  proxy.hookPacket('PLAYERHIT', (_client, packet) => {
    const data = packet.data ?? packet;
    const bulletId = Number(data.bulletId);
    const objectId = Number(data.objectId);   // bullet's owner
    if (!Number.isFinite(bulletId) || !Number.isFinite(objectId)) return;
    const proj = projectileTracker.getBullet(`${objectId}:${bulletId}`);
    if (!proj || !Number.isFinite(proj.damage) || proj.damage <= 0) return;
    // silent=0: this hit is committed (client just acked it to the server).
    sendDllFeature('autonexusOnDamage', `${proj.damage},0`);
  });

  // Outgoing AOEACK — the client acks AOE damage. Match the position back
  // to the AOE we cached earlier to recover the damage value.
  proxy.hookPacket('AOEACK', (_client, packet) => {
    const data = packet.data ?? packet;
    const pos = data.position as { x: number; y: number } | undefined;
    if (!pos) return;
    const dmg = consumeAoeAt(pos.x, pos.y);
    if (dmg > 0) {
      sendDllFeature('autonexusOnDamage', `${dmg},0`);
    }
  });

  // Incoming NEWTICK — server's authoritative HP/MaxHp for every visible
  // object. Pluck our row by ownerObjectId on the ClientConnection's
  // PlayerData, then forward Hp/MaxHp to the DLL for tracker resync.
  // xrDriver: ProcessStatus(stat.type==0 → MaxHp, ==1 → Hp; isFirstPacket
  // also re-initializes clientHp). We forward both and let the DLL handle
  // first-vs-subsequent logic.
  proxy.hookPacket('NEWTICK', (client, packet) => {
    const myObjId = (client?.playerData?.ownerObjectId ?? null) as number | null;
    if (myObjId == null) return;
    const data = packet.data ?? packet;
    const statuses: any[] = (data.statuses as any[]) ?? [];
    let me: any = null;
    for (const s of statuses) {
      if (Number(s?.objectId) === myObjId) { me = s; break; }
    }
    if (!me) return;
    const stats: any[] = (me.stats as any[]) ?? [];
    let hp = -1, maxHp = -1;
    for (const s of stats) {
      const t = Number(s?.statType);
      const v = Number(s?.statValue);
      if (!Number.isFinite(v)) continue;
      if (t === STAT_TYPE_MAXHP)      maxHp = v;
      else if (t === STAT_TYPE_HP)    hp    = v;
    }
    if (hp >= 0 && maxHp > 0) {
      sendDllFeature('autonexusSyncHp', `${hp},${maxHp}`);
    }
  });
}
