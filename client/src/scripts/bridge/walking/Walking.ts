import { Walking } from '@realmengine/sdk';
import type { Position } from '@realmengine/sdk';
import type { Enemy } from '@realmengine/sdk';
import type { BridgeDeps } from '../BridgeDeps.js';
import { warnUnimplemented } from '../stubWarn.js';
import { sendDllFeature } from '../../../bridge/DllFeatureBus.js';
import { Logger } from '../../../util/Logger.js';

let walkTarget: { x: number; y: number } | null = null;

export class BridgeWalking {
  static install(deps: BridgeDeps): void {
    const playerPos = (): { x: number; y: number } | null => {
      const pd = deps.clientRef.current?.playerData;
      return pd ? { x: pd.pos.x, y: pd.pos.y } : null;
    };

    Walking.walkTo = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      walkTarget = { x, y };
      sendDllFeature('walkTargetX', x);
      sendDllFeature('walkTargetY', y);
      sendDllFeature('walkTargetActive', true);
      return true;
    };

    Walking.walkToPosition = (position: Position) => {
      return Walking.walkTo(position.x, position.y);
    };

    Walking.walkToEnemy = (enemy: Enemy) => {
      const e = enemy as unknown as { x?: number; y?: number; pos?: { x: number; y: number } };
      const x = e.pos?.x ?? e.x;
      const y = e.pos?.y ?? e.y;
      if (x === undefined || y === undefined) return false;
      return Walking.walkTo(x, y);
    };

    const walkToPortalMatching = (
      match: ((objName: string) => boolean) | null,
    ): boolean => {
      const origin = playerPos();
      if (!origin) return false;
      const portals = deps.worldState.getPortalsSorted(deps.gameData, origin);
      for (const p of portals) {
        if (!match) return Walking.walkTo(p.x, p.y);
        const objName = String(deps.gameData.getObject(p.objectType)?.id ?? '').toLowerCase();
        if (match(objName)) return Walking.walkTo(p.x, p.y);
      }
      return false;
    };

    Walking.walkToPortal = (name: string) => {
      const needle = name.toLowerCase();
      return walkToPortalMatching((n) => n.includes(needle));
    };
    Walking.walkToNearestPortal = () => walkToPortalMatching(null);
    // "Portal to Nexus" goes back; "Nexus Portal" is a realm entrance, and a
    // substring match on "nexus" picked whichever was nearer.
    Walking.walkToNexusPortal = () => walkToPortalMatching((n) => n === 'portal to nexus');

    Walking.walkToLeftWall = () => {
      warnUnimplemented('Walking.walkToLeftWall');
      return false;
    };

    Walking.walkToRightWall = () => {
      warnUnimplemented('Walking.walkToRightWall');
      return false;
    };

    Walking.walkToTopWall = () => {
      warnUnimplemented('Walking.walkToTopWall');
      return false;
    };

    Walking.walkToBottomWall = () => {
      warnUnimplemented('Walking.walkToBottomWall');
      return false;
    };

    Walking.followPlayer = (_name: string) => {
      warnUnimplemented('Walking.followPlayer');
      return false;
    };

    Walking.stopMoving = () => {
      walkTarget = null;
      sendDllFeature('walkTargetActive', false);
    };

    Walking.isMoving = () => {
      if (!walkTarget) return false;
      const p = playerPos();
      if (!p) return false;
      return Math.hypot(p.x - walkTarget.x, p.y - walkTarget.y) > 0.6;
    };

    Walking.hasReached = (position: Position, tolerance = 0.5) => {
      const p = playerPos();
      if (!p) return false;
      return Math.hypot(p.x - position.x, p.y - position.y) <= tolerance;
    };

    Walking.nexus = () => {
      const c = deps.clientRef.current;
      if (!c?.connected) return;
      try {
        const packet = deps.proxy.packetFactory.createByName('ESCAPE');
        packet.modified = true;
        c.sendToServer(packet);
      } catch {
        // void API — ignore factory/send errors (e.g. no connection mid-send)
      }
    };

    Walking.getDodgePosition = (): Position | null => {
      warnUnimplemented('Walking.getDodgePosition');
      return null;
    };

    Walking.dodge = () => {
      warnUnimplemented('Walking.dodge');
      return false;
    };

    Walking.dodgeFrom = (_enemy: Enemy) => {
      warnUnimplemented('Walking.dodgeFrom');
      return false;
    };

    Walking.canTeleport = (): boolean => {
      return deps.clientRef.current?.playerData.teleportAllowed ?? false;
    };

    Walking.teleportToPlayer = (name: string): boolean => {
      const c = deps.clientRef.current;
      if (!c?.connected) return false;
      if (!c.playerData.teleportAllowed) {
        Logger.warn('Walking', 'teleportToPlayer: teleport not allowed in this map');
        return false;
      }
      const q = name.trim().toLowerCase();
      const rows = deps.worldState.getAllPlayersRawStatsForDashboard(deps.gameData);
      let row = rows.find(r => r.name.trim().toLowerCase() === q);
      if (!row) row = rows.find(r => r.name.toLowerCase().includes(q));
      if (!row) {
        Logger.warn('Walking', `teleportToPlayer: player "${name}" not found in world state`);
        return false;
      }
      try {
        const pkt = deps.proxy.packetFactory.createByName('TELEPORT');
        pkt.data.objectId = row.objectId;
        pkt.modified = true;
        c.sendToServer(pkt);
        return true;
      } catch (err) {
        Logger.warn('Walking', `teleportToPlayer: send failed — ${(err as Error).message}`);
        return false;
      }
    };

    // No teleportAllowed gate here: that MAPINFO flag governs player-to-player
    // teleports. Beacon teleports work in realms where the flag is false.
    Walking.teleportToBeacon = (objectId: number): boolean => {
      const c = deps.clientRef.current;
      if (!c?.connected) return false;
      try {
        const pkt = deps.proxy.packetFactory.createByName('TELEPORT');
        pkt.data.objectId = objectId;
        pkt.modified = true;
        c.sendToServer(pkt);
        return true;
      } catch (err) {
        Logger.warn('Walking', `teleportToBeacon: send failed — ${(err as Error).message}`);
        return false;
      }
    };
  }
}
