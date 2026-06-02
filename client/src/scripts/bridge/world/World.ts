import { World } from '@realmengine/sdk';
import type { BridgeDeps } from '../BridgeDeps.js';
import type { BeaconObject } from '@realmengine/sdk';
import { GameId } from '../../../constants/GameId.js';
import { activeController } from '../../../movement/activeMovementController.js';
import { Logger } from '../../../util/Logger.js';

// Set RE_NAV_DEBUG=1 to enable verbose world-bridge logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

/**
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [World] isDungeon — mapName="X" gameId=N → true  (matched dungeonNameSet)
 *   [World] isDungeon — mapName="X" gameId=N → false (nexus/realm/vault/known-safe)
 *   [World] isDungeon — mapName="X" gameId=N → false (no match in dungeonNameSet, size=N)
 *   [World] findBeacon("query") → "Beacon Name" id=X objectType=0xX dist=Y.Y at (x,y)
 *   [World] findBeacon("query") → null (N beacons checked)
 *   [World] enterRealm — found "Realm Portal" id=X dist=Y.Y at (x,y) → walkTo started
 *   [World] enterRealm — no realm portal found (N portals visible)
 *   [World] enterRealm — not in nexus (map="X")
 *
 * Errors (always visible):
 *   [World] enterRealm: not in nexus
 *   [World] enterRealm: no realm portal found in nexus
 *   [World] enterRealm: MovementController not initialized
 */

function mapNameLower(deps: BridgeDeps): string {
  return (deps.clientRef.current?.playerData?.mapName ?? '').toLowerCase();
}

/** Lazy-built set of dungeon map names from portal dungeonName fields. */
let dungeonNameSet: Set<string> | null = null;

function getDungeonNameSet(deps: BridgeDeps): Set<string> {
  if (dungeonNameSet) return dungeonNameSet;
  dungeonNameSet = new Set<string>();
  for (const obj of deps.gameData.getAllObjects()) {
    if (obj.dungeonName && obj.dungeonName.trim()) {
      dungeonNameSet.add(obj.dungeonName.trim().toLowerCase());
    }
  }
  if (NAV_DEBUG) Logger.log('World', `dungeonNameSet built — ${dungeonNameSet.size} dungeon names loaded`);
  return dungeonNameSet;
}

export class BridgeWorld {
  static install(deps: BridgeDeps): void {
    World.isNexus = () => {
      const gid = deps.clientRef.current?.state?.gameId;
      if (gid === GameId.Nexus) return true;
      return mapNameLower(deps).includes('nexus');
    };

    World.isRealm = () => {
      const n = mapNameLower(deps);
      return n.includes('realm of the mad god') || n === 'realm';
    };

    World.isDungeon = () => {
      if (World.isNexus() || World.isRealm() || World.isVault()) {
        if (NAV_DEBUG) Logger.log('World', `isDungeon — mapName="${mapNameLower(deps)}" → false (nexus/realm/vault)`);
        return false;
      }
      const gid = deps.clientRef.current?.state?.gameId as number | undefined;
      const knownSafe =
        gid === GameId.Tutorial ||
        gid === GameId.RandomRealm ||
        gid === GameId.MapTest ||
        gid === GameId.VaultExplanation ||
        gid === GameId.NexusExplanation ||
        gid === GameId.QuestRoom ||
        gid === GameId.CheatersQuarantine;
      if (knownSafe) {
        if (NAV_DEBUG) Logger.log('World', `isDungeon — mapName="${mapNameLower(deps)}" gameId=${gid} → false (known-safe gameId)`);
        return false;
      }
      const name = mapNameLower(deps).trim();
      if (!name) {
        if (NAV_DEBUG) Logger.log('World', 'isDungeon — empty mapName → false');
        return false;
      }
      const set = getDungeonNameSet(deps);
      const result = set.has(name);
      if (NAV_DEBUG) Logger.log('World', `isDungeon — mapName="${name}" gameId=${gid} → ${result} (dungeonNameSet size=${set.size})`);
      return result;
    };

    World.isVault = () => {
      const gid = deps.clientRef.current?.state?.gameId;
      if (gid === GameId.Vault) return true;
      return mapNameLower(deps).includes('vault');
    };

    World.getName = () => {
      return deps.clientRef.current?.playerData?.mapName ?? '';
    };

    World.findBeacon = (name: string): BeaconObject | null => {
      const c = deps.clientRef.current;
      if (!c?.connected) {
        if (NAV_DEBUG) Logger.log('World', `findBeacon("${name}") → null (no client)`);
        return null;
      }
      const q = name.trim().toLowerCase();
      if (!q) return null;
      const beacons = deps.worldState.getBeaconsSorted(deps.gameData, c.playerData.pos);
      for (const b of beacons) {
        if (b.name.toLowerCase().includes(q)) {
          if (NAV_DEBUG) Logger.log('World', `findBeacon("${name}") → "${b.name}" id=${b.objectId} objectType=0x${b.objectType.toString(16)} dist=${b.dist.toFixed(2)} at (${b.x.toFixed(2)},${b.y.toFixed(2)})`);
          return { objectId: b.objectId, objectType: b.objectType, x: b.x, y: b.y, name: b.name };
        }
      }
      if (NAV_DEBUG) Logger.log('World', `findBeacon("${name}") → null (${beacons.length} beacons checked)`);
      return null;
    };

    World.enterRealm = async (): Promise<boolean> => {
      if (!World.isNexus()) {
        Logger.warn('World', `enterRealm: not in nexus (map="${World.getName()}")`);
        return false;
      }
      const c = deps.clientRef.current;
      if (!c?.connected) return false;
      const origin = c.playerData.pos;
      const portals = deps.worldState.getPortalsSorted(deps.gameData, origin);
      const realmPortal = portals.find((p) => {
        const def = deps.gameData.getObject(p.objectType);
        return (
          (def?.dungeonName ?? '').toLowerCase().includes('realm') ||
          (def?.id ?? '').toLowerCase().includes('realm')
        );
      });
      if (!realmPortal) {
        Logger.warn('World', `enterRealm: no realm portal found in nexus (${portals.length} portals visible)`);
        return false;
      }
      const def = deps.gameData.getObject(realmPortal.objectType);
      if (NAV_DEBUG) Logger.log('World', `enterRealm — found "${def?.id ?? '?'}" id=${realmPortal.objectId} dist=${realmPortal.dist.toFixed(2)} at (${realmPortal.x.toFixed(2)},${realmPortal.y.toFixed(2)}) → walkTo started`);
      const controller = activeController;
      if (!controller) {
        Logger.warn('World', 'enterRealm: MovementController not initialized');
        return false;
      }
      void controller.walkTo(realmPortal.x, realmPortal.y);
      return true;
    };
  }
}
