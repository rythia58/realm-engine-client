import { Walking, chat } from '@realmengine/sdk';
import type { NodeContext, Vec2 } from './GraphInterpreter.js';
import type { BridgeClientRef } from '../bridge/BridgeDeps.js';
import type { GameWorldState } from '../../state/GameWorldState.js';
import type { GameDataLoader } from '../../game-data/GameDataLoader.js';
import type { Proxy } from '../../proxy/Proxy.js';
import type { PluginManager } from '../../plugins/PluginManager.js';
import { sendDllFeature } from '../../bridge/DllFeatureBus.js';
import { Logger } from '../../util/Logger.js';

export interface VisualContextDeps {
  clientRef: BridgeClientRef;
  worldState: GameWorldState;
  gameData: GameDataLoader;
  proxy: Proxy;
  pluginManager: PluginManager;
  onPluginStateChanged?: () => void;
  emitLog?: (scriptId: string, line: string, level: 'info' | 'warn' | 'error') => void;
}

export function buildNodeContext(deps: VisualContextDeps, scriptId: string, saved: Map<string, Vec2>): NodeContext {
  const playerPos = (): Vec2 | null => {
    const pd = deps.clientRef.current?.playerData;
    return pd ? { x: pd.pos.x, y: pd.pos.y } : null;
  };

  return {
    getPlayerPos: playerPos,

    getPlayerStats: () => {
      const pd = deps.clientRef.current?.playerData;
      if (!pd) return null;
      return { hp: pd.health, maxHp: pd.maxHealth, mp: pd.mana, maxMp: pd.maxMana, level: pd.level };
    },

    hasEffect: (name) => {
      const pd = deps.clientRef.current?.playerData;
      if (!pd) return false;
      try {
        return pd.hasConditionEffect(name as never);
      } catch {
        return false;
      }
    },

    playerCount: (radius) => {
      const rows = deps.worldState.getAllPlayersRawStatsForDashboard(deps.gameData);
      if (radius <= 0) return rows.length;
      const p = playerPos();
      if (!p) return rows.length;
      return rows.filter(r => Math.hypot(r.x - p.x, r.y - p.y) <= radius).length;
    },

    listPlayers: () => {
      return deps.worldState.getAllPlayersRawStatsForDashboard(deps.gameData)
        .map(r => ({ name: r.name, x: r.x, y: r.y }));
    },

    listObjects: (filter, radius) => {
      const origin = playerPos();
      if (!origin) return [];
      const f = String(filter ?? '').trim().toLowerCase();

      if (f === 'enemy' || f === 'enemies') {
        return deps.worldState.getEnemiesMatching(deps.gameData, origin, { maxDistance: radius })
          .map(e => ({
            id: e.objectId, type: e.objectType,
            name: String(deps.gameData.getObject(e.objectType)?.id ?? ''),
            x: e.x, y: e.y, dist: e.dist,
          }));
      }

      const typeNum = /^\d+$/.test(f) ? Number(f) : null;
      const out: Array<{ id: number; type: number; name: string; x: number; y: number; dist: number }> = [];
      for (const e of deps.worldState.getEntitiesInRadius(origin, radius)) {
        const defName = String(deps.gameData.getObject(e.objectType)?.id ?? '');
        // Stat 31 is the live name — realm portals show "Squall (7/85)", not their XML id.
        const liveName = String(e.stats?.['31'] ?? '');
        const category = deps.gameData.getObjectCategory(e.objectType);
        const name = liveName || defName;
        const matches =
          f === '' ||
          (typeNum !== null && e.objectType === typeNum) ||
          defName.toLowerCase().includes(f) ||
          liveName.toLowerCase().includes(f) ||
          (f === 'portal' && category === 'Portal') ||
          // "Beacon" also covers decorative light beams and the visual-only "Actual Active
          // Beacon" twin; only "Teleport Beacon <Biome>" is a valid teleport target.
          (f === 'beacon' && /^teleport beacon/i.test(defName)) ||
          // Realm entrances are XML "Nexus Portal"; their live name is the realm ("Squall (7/85)").
          (f === 'realm portal' && category === 'Portal' &&
            (/^nexus portal$/i.test(defName) || /realm|\(\d+\/\d+\)/i.test(liveName)));
        if (!matches) continue;
        out.push({
          id: e.objectId, type: e.objectType, name,
          x: e.pos.x, y: e.pos.y,
          dist: Math.hypot(e.pos.x - origin.x, e.pos.y - origin.y),
        });
      }
      out.sort((a, b) => a.dist - b.dist);
      return out;
    },

    questTarget: () => {
      const pd = deps.clientRef.current?.playerData;
      if (!pd || pd.questObjectId < 0) return null;
      const e = deps.worldState.getEntity(pd.questObjectId);
      return e ? { id: pd.questObjectId, x: e.pos.x, y: e.pos.y } : null;
    },

    moveTo: (x, y) => { Walking.walkTo(x, y); },
    stopMoving: () => Walking.stopMoving(),
    hasReached: (x, y, tol) => Walking.hasReached({ x, y } as never, tol),

    enterPortal: (objectId) => {
      const c = deps.clientRef.current;
      if (!c?.connected) return false;
      let id = objectId;
      if (id === undefined) {
        const origin = playerPos();
        if (!origin) return false;
        id = deps.worldState.getNearestPortal(deps.gameData, origin)?.objectId;
      }
      if (id === undefined || id < 0) return false;
      try {
        const pkt = deps.proxy.packetFactory.createByName('USEPORTAL');
        pkt.data.objectId = id;
        pkt.modified = true;
        c.sendToServer(pkt);
        return true;
      } catch (err) {
        Logger.warn('VisualScripts', `enterPortal failed: ${(err as Error).message}`);
        return false;
      }
    },

    useItem: (slot) => {
      const c = deps.clientRef.current;
      if (!c?.connected) return false;
      const pd = c.playerData;
      const itemId = pd.inventory[slot] ?? -1;
      if (itemId <= 0) return false;
      try {
        const pkt = deps.proxy.packetFactory.createByName('USEITEM');
        pkt.data.time = Math.trunc(c.time);
        pkt.data.slotObject = { objectId: c.objectId, slotId: slot, objectType: itemId };
        pkt.data.itemUsePos = { x: pd.pos.x, y: pd.pos.y };
        pkt.data.useType = 1;
        pkt.data.unknownInt = 0;
        pkt.modified = true;
        c.sendToServer(pkt);
        return true;
      } catch (err) {
        Logger.warn('VisualScripts', `useItem failed: ${(err as Error).message}`);
        return false;
      }
    },

    sendChat: (text) => {
      try { chat.send(text); } catch { /* not connected */ }
    },

    nexus: () => Walking.nexus(),

    resetTileCache: () => deps.worldState.clear(),

    mapName: () => deps.clientRef.current?.playerData.mapName ?? '',

    savePosition: (slot, pos) => { saved.set(slot, { x: pos.x, y: pos.y }); },
    getSavedPosition: (slot) => saved.get(slot) ?? null,

    teleportToPlayer: (name) => Walking.teleportToPlayer(name),
    teleportToBeacon: (objectId) => Walking.teleportToBeacon(objectId),
    canTeleport: () => Walking.canTeleport(),

    setPluginEnabled: (pluginId, enabled) => {
      const ok = deps.pluginManager.togglePlugin(pluginId, enabled).ok;
      if (ok) deps.onPluginStateChanged?.();
      return ok;
    },

    setDllFeature: (key, value) => { sendDllFeature(key, value); },

    notify: (text) => { sendDllFeature('showPluginFloatingText', text.slice(0, 120)); },

    log: (line, level) => {
      deps.emitLog?.('visual:' + scriptId, line, level ?? 'info');
      Logger.log('VisualScripts', `[${scriptId}] ${line}`);
    },
  };
}
