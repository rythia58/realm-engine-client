import { Walking } from '@realmengine/sdk';
import type { Position } from '@realmengine/sdk';
import type { Enemy } from '@realmengine/sdk';
import type { WalkOptions } from '@realmengine/sdk';
import type { BridgeDeps } from '../BridgeDeps.js';
import { Logger } from '../../../util/Logger.js';
import { MovementController } from '../../../movement/MovementController.js';
import { setActiveController } from '../../../movement/activeMovementController.js';

// Set RE_NAV_DEBUG=1 to enable verbose walking-bridge logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

/**
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [Walking] walkTo (x,y) from (fx,fy) — fire-and-forget
 *   [Walking] walkToAsync (x,y) opts={...}
 *   [Walking] walkToPortal("name") → found "Portal Name" id=X objectType=0xX dist=Y.Y at (x,y)
 *   [Walking] walkToPortal("name") → NOT FOUND (N portals visible)
 *   [Walking] walkToNearestPortal → "Name" id=X dist=Y.Y at (x,y)
 *   [Walking] walkToNearestPortal → NO PORTALS VISIBLE
 *   [Walking] walkToNexusPortal → "Nexus Portal" id=X dist=Y.Y
 *   [Walking] walkToNexusPortal → NOT FOUND (N portals checked)
 *   [Walking] walkToEnemy → "Name" id=X at (x,y)
 *   [Walking] followPlayer("name") → "ActualName" at (x,y)
 *   [Walking] followPlayer("name") → NOT FOUND (N players visible)
 *   [Walking] teleportToBeacon(id) → SENT  |  teleport not allowed
 *   [Walking] teleportToPlayer("name") → SENT to "ActualName" id=X
 *   [Walking] stopMoving — was active=true/false
 *
 * Errors (always visible — existing Logger.warn calls):
 *   walkToPortal: no portal matching "..." found
 *   teleportToBeacon/Player: teleport not allowed | send failed
 */
export class BridgeWalking {
  static install(deps: BridgeDeps): void {
    const controller = new MovementController(deps, deps.worldState);
    setActiveController(controller);

    const getClient = () => deps.clientRef.current;

    // ─── Walk methods ────────────────────────────────────────────────

    Walking.walkTo = (x: number, y: number): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      if (NAV_DEBUG) {
        const pos = c.playerData.pos;
        Logger.log('Walking', `walkTo (${x.toFixed(2)},${y.toFixed(2)}) from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) — fire-and-forget`);
      }
      void controller.walkTo(x, y);
      return true;
    };

    Walking.walkToAsync = (x: number, y: number, opts?: WalkOptions) => {
      if (NAV_DEBUG) {
        const c = getClient();
        const pos = c?.playerData.pos;
        Logger.log('Walking', `walkToAsync (${x.toFixed(2)},${y.toFixed(2)}) from (${pos?.x.toFixed(2) ?? '?'},${pos?.y.toFixed(2) ?? '?'}) opts=${JSON.stringify(opts ?? {})}`);
      }
      return controller.walkTo(x, y, opts);
    };

    Walking.walkToPosition = (position: Position): boolean =>
      Walking.walkTo(position.x, position.y);

    Walking.walkToEnemy = (enemy: Enemy): boolean => {
      if (NAV_DEBUG) Logger.log('Walking', `walkToEnemy → "${enemy.name}" id=${enemy.objectId} at (${enemy.position.x.toFixed(2)},${enemy.position.y.toFixed(2)})`);
      return Walking.walkTo(enemy.position.x, enemy.position.y);
    };

    Walking.walkToPortal = (name: string): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const origin = c.playerData.pos;
      const q = name.trim().toLowerCase();
      const portals = deps.worldState.getPortalsSorted(deps.gameData, origin);
      const portal = portals.find((p) => {
        const def = deps.gameData.getObject(p.objectType);
        return (
          (def?.id ?? '').toLowerCase().includes(q) ||
          (def?.dungeonName ?? '').toLowerCase().includes(q) ||
          (def?.displayId ?? '').toLowerCase().includes(q)
        );
      });
      if (!portal) {
        Logger.warn('Walking', `walkToPortal: no portal matching "${name}" found (${portals.length} portals visible)`);
        return false;
      }
      const def = deps.gameData.getObject(portal.objectType);
      if (NAV_DEBUG) Logger.log('Walking', `walkToPortal("${name}") → found "${def?.id ?? '?'}" id=${portal.objectId} objectType=0x${portal.objectType.toString(16)} dist=${portal.dist.toFixed(2)} at (${portal.x.toFixed(2)},${portal.y.toFixed(2)})`);
      void controller.walkTo(portal.x, portal.y);
      return true;
    };

    Walking.walkToNearestPortal = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const portal = deps.worldState.getNearestPortal(deps.gameData, c.playerData.pos);
      if (!portal) {
        Logger.warn('Walking', 'walkToNearestPortal: no portals visible');
        return false;
      }
      const def = deps.gameData.getObject(portal.objectType);
      if (NAV_DEBUG) Logger.log('Walking', `walkToNearestPortal → "${def?.id ?? '?'}" id=${portal.objectId} dist=${portal.dist.toFixed(2)} at (${portal.x.toFixed(2)},${portal.y.toFixed(2)})`);
      void controller.walkTo(portal.x, portal.y);
      return true;
    };

    Walking.walkToNexusPortal = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const origin = c.playerData.pos;
      const portals = deps.worldState.getPortalsSorted(deps.gameData, origin);
      const nexus = portals.find((p) => {
        const def = deps.gameData.getObject(p.objectType);
        return (def?.id ?? '').toLowerCase().includes('nexus');
      });
      if (!nexus) {
        Logger.warn('Walking', `walkToNexusPortal: not found (${portals.length} portals checked)`);
        return false;
      }
      const def = deps.gameData.getObject(nexus.objectType);
      if (NAV_DEBUG) Logger.log('Walking', `walkToNexusPortal → "${def?.id ?? '?'}" id=${nexus.objectId} dist=${nexus.dist.toFixed(2)} at (${nexus.x.toFixed(2)},${nexus.y.toFixed(2)})`);
      void controller.walkTo(nexus.x, nexus.y);
      return true;
    };

    Walking.walkToRealmPortal = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const origin = c.playerData.pos;
      const portals = deps.worldState.getPortalsSorted(deps.gameData, origin);
      const realm = portals.find((p) => {
        const def = deps.gameData.getObject(p.objectType);
        const id = (def?.id ?? '').toLowerCase();
        const dungeonName = (def?.dungeonName ?? '').toLowerCase();
        return (
          id === 'nexus portal' ||          // 0x0712 — dynamic realm portals in nexus
          id.includes('realm portal') ||    // 0x0704, 0x070e, 0xCAD2
          dungeonName.includes('realm')
        );
      });
      if (!realm) {
        Logger.warn('Walking', `walkToRealmPortal: not found (${portals.length} portals checked)`);
        return false;
      }
      const def = deps.gameData.getObject(realm.objectType);
      if (NAV_DEBUG) Logger.log('Walking', `walkToRealmPortal → "${def?.id ?? '?'}" id=${realm.objectId} dist=${realm.dist.toFixed(2)} at (${realm.x.toFixed(2)},${realm.y.toFixed(2)})`);
      void controller.walkTo(realm.x, realm.y);
      return true;
    };

    Walking.walkToLeftWall = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const pos = c.playerData.pos;
      if (NAV_DEBUG) Logger.log('Walking', `walkToLeftWall from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) → (0.5,${pos.y.toFixed(2)})`);
      void controller.walkTo(0.5, pos.y);
      return true;
    };

    Walking.walkToRightWall = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const pos = c.playerData.pos;
      const width = c.playerData.mapWidth ?? 2048;
      if (NAV_DEBUG) Logger.log('Walking', `walkToRightWall from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) → (${width - 0.5},${pos.y.toFixed(2)}) mapWidth=${width}`);
      void controller.walkTo(width - 0.5, pos.y);
      return true;
    };

    Walking.walkToTopWall = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const pos = c.playerData.pos;
      if (NAV_DEBUG) Logger.log('Walking', `walkToTopWall from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) → (${pos.x.toFixed(2)},0.5)`);
      void controller.walkTo(pos.x, 0.5);
      return true;
    };

    Walking.walkToBottomWall = (): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const pos = c.playerData.pos;
      const height = c.playerData.mapHeight ?? 2048;
      if (NAV_DEBUG) Logger.log('Walking', `walkToBottomWall from (${pos.x.toFixed(2)},${pos.y.toFixed(2)}) → (${pos.x.toFixed(2)},${height - 0.5}) mapHeight=${height}`);
      void controller.walkTo(pos.x, height - 0.5);
      return true;
    };

    Walking.followPlayer = (name: string): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      const q = name.trim().toLowerCase();
      const rows = deps.worldState.getAllPlayersRawStatsForDashboard(deps.gameData);
      const row = rows.find((r) => r.name.trim().toLowerCase() === q) ??
                  rows.find((r) => r.name.toLowerCase().includes(q));
      if (!row) {
        Logger.warn('Walking', `followPlayer("${name}"): not found (${rows.length} players visible)`);
        return false;
      }
      if (NAV_DEBUG) Logger.log('Walking', `followPlayer("${name}") → "${row.name}" at (${row.x.toFixed(2)},${row.y.toFixed(2)})`);
      void controller.walkTo(row.x, row.y);
      return true;
    };

    Walking.stopMoving = (): void => {
      if (NAV_DEBUG) Logger.log('Walking', `stopMoving — was active=${controller.isActive()}`);
      controller.cancel();
    };

    Walking.isMoving = (): boolean => controller.isActive();

    Walking.hasReached = (position: Position, tolerance = 0.5): boolean => {
      const c = getClient();
      if (!c) return false;
      const pos = c.playerData.pos;
      return Math.hypot(pos.x - position.x, pos.y - position.y) <= tolerance;
    };

    // ─── Teleport & nexus ────────────────────────────────────────────

    Walking.nexus = () => {
      const c = getClient();
      if (!c?.connected) return;
      if (NAV_DEBUG) Logger.log('Walking', `nexus — sending ESCAPE from map="${c.playerData.mapName}"`);
      try {
        const packet = deps.proxy.packetFactory.createByName('ESCAPE');
        packet.modified = true;
        c.sendToServer(packet);
      } catch {
        // void API — ignore errors
      }
    };

    Walking.canTeleport = (): boolean =>
      getClient()?.playerData.teleportAllowed ?? false;

    Walking.teleportToPlayer = (name: string): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      if (!c.playerData.teleportAllowed) {
        Logger.warn('Walking', 'teleportToPlayer: teleport not allowed in this map');
        return false;
      }
      const q = name.trim().toLowerCase();
      const rows = deps.worldState.getAllPlayersRawStatsForDashboard(deps.gameData);
      let row = rows.find((r) => r.name.trim().toLowerCase() === q);
      if (!row) row = rows.find((r) => r.name.toLowerCase().includes(q));
      if (!row) {
        Logger.warn('Walking', `teleportToPlayer("${name}"): not found (${rows.length} players visible)`);
        return false;
      }
      try {
        const pkt = deps.proxy.packetFactory.createByName('TELEPORT');
        pkt.data.objectId = row.objectId;
        pkt.modified = true;
        c.sendToServer(pkt);
        if (NAV_DEBUG) Logger.log('Walking', `teleportToPlayer("${name}") → SENT to "${row.name}" id=${row.objectId} at (${row.x.toFixed(2)},${row.y.toFixed(2)})`);
        return true;
      } catch (err) {
        Logger.warn('Walking', `teleportToPlayer: send failed — ${(err as Error).message}`);
        return false;
      }
    };

    Walking.teleportToBeacon = (objectId: number): boolean => {
      const c = getClient();
      if (!c?.connected) return false;
      if (!c.playerData.teleportAllowed) {
        Logger.warn('Walking', `teleportToBeacon(${objectId}): teleport not allowed in this map`);
        return false;
      }
      try {
        const pkt = deps.proxy.packetFactory.createByName('TELEPORT');
        pkt.data.objectId = objectId;
        pkt.modified = true;
        c.sendToServer(pkt);
        if (NAV_DEBUG) {
          const entity = deps.worldState.getEntity(objectId);
          const def = entity ? deps.gameData.getObject(entity.objectType) : null;
          Logger.log('Walking', `teleportToBeacon(${objectId}) → SENT | beacon="${def?.id ?? '?'}" pos=(${entity?.pos.x.toFixed(2) ?? '?'},${entity?.pos.y.toFixed(2) ?? '?'})`);
        }
        return true;
      } catch (err) {
        Logger.warn('Walking', `teleportToBeacon(${objectId}): send failed — ${(err as Error).message}`);
        return false;
      }
    };

    // Unsupported stubs — not enough data on the wire
    Walking.getDodgePosition = (): Position | null => null;
    Walking.dodge = (): boolean => false;
    Walking.dodgeFrom = (_enemy: Enemy): boolean => false;
  }
}
