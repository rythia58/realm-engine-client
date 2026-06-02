import { Enemies, Position } from '@realmengine/sdk';
import type { Enemy } from '@realmengine/sdk';
import type { BridgeDeps } from '../BridgeDeps.js';
import type { TrackedEntity } from '../../../state/GameWorldState.js';
import type { GameDataLoader } from '../../../game-data/GameDataLoader.js';
import { StatType } from '../../../constants/StatType.js';
import { Logger } from '../../../util/Logger.js';

// Set RE_NAV_DEBUG=1 to enable verbose enemy-bridge logs
const NAV_DEBUG = process.env['RE_NAV_DEBUG'] === '1';

/**
 * DIAGNOSTICS (RE_NAV_DEBUG=1):
 *   [Enemies] getAll → N enemies (nearest: "Name" id=X dist=Y.Y)
 *   [Enemies] getAll → 0 enemies (no client or none visible)
 *   [Enemies] getNearest → "Name" id=X objectType=X dist=Y.Y hp=N/N isBoss=false
 *   [Enemies] getNearest → null (no enemies)
 *   [Enemies] getBoss → "Name" id=X dist=Y.Y hp=N/N
 *   [Enemies] getBoss → null (no boss entities)
 *   [Enemies] find("query") → "Name" id=X dist=Y.Y  |  find("query") → null (N candidates checked)
 *   [Enemies] getById(X) → "Name" dist=Y.Y  |  getById(X) → null (not found / not enemy)
 *   [Enemies] getByType(X) → N results
 *   [Enemies] count → N
 */

function toSdkEnemy(entity: TrackedEntity, gameData: GameDataLoader): Enemy {
  const def = gameData.getObject(entity.objectType);
  const s = entity.stats ?? {};

  const hp = Number.isFinite(Number(s[String(StatType.HP)])) ? Number(s[String(StatType.HP)]) : 0;
  const wireMaxHp = Number(s[String(StatType.MaxHP)]);
  const maxHp = Number.isFinite(wireMaxHp) && wireMaxHp > 0 ? wireMaxHp : (def?.maxHp ?? Math.max(1, hp));

  const name = def?.displayId || def?.id || `0x${entity.objectType.toString(16)}`;
  const defense = def?.defense ?? 0;

  return {
    objectType: entity.objectType,
    objectId: entity.objectId,
    name,
    position: new Position(entity.pos.x, entity.pos.y),
    hp,
    maxHp,
    defense,
    stats: {
      maxHP: maxHp,
      maxMP: 0,
      attack: 0,
      defense,
      speed: 0,
      dexterity: 0,
      vitality: 0,
      wisdom: 0,
    },
    phase: 0,
    isEnraged: false,
    isBoss: gameData.isBoss(entity.objectType),
    isTargetingMe: false,
  };
}

function origin(deps: BridgeDeps): { x: number; y: number } {
  return deps.clientRef.current?.playerData.pos ?? { x: 0, y: 0 };
}

function distTo(o: { x: number; y: number }, e: { x: number; y: number }): string {
  return Math.hypot(o.x - e.x, o.y - e.y).toFixed(2);
}

export class BridgeEnemies {
  static install(deps: BridgeDeps): void {
    Enemies.getAll = (): Enemy[] => {
      if (!deps.clientRef.current?.connected) {
        if (NAV_DEBUG) Logger.log('Enemies', 'getAll → 0 (no client)');
        return [];
      }
      const org = origin(deps);
      const candidates = deps.worldState.getEnemiesMatching(deps.gameData, org);
      const result: Enemy[] = [];
      for (const c of candidates) {
        const entity = deps.worldState.getEntity(c.objectId);
        if (entity) result.push(toSdkEnemy(entity, deps.gameData));
      }
      if (NAV_DEBUG) {
        const nearest = result[0];
        const hint = nearest
          ? ` (nearest: "${nearest.name}" id=${nearest.objectId} dist=${distTo(org, nearest.position)})`
          : ' (none visible)';
        Logger.log('Enemies', `getAll → ${result.length} enemies${hint}`);
      }
      return result;
    };

    Enemies.getNearest = (): Enemy | null => {
      if (!deps.clientRef.current?.connected) {
        if (NAV_DEBUG) Logger.log('Enemies', 'getNearest → null (no client)');
        return null;
      }
      const org = origin(deps);
      const c = deps.worldState.getNearestEnemy(deps.gameData, org);
      if (!c) {
        if (NAV_DEBUG) Logger.log('Enemies', 'getNearest → null (no enemies)');
        return null;
      }
      const entity = deps.worldState.getEntity(c.objectId);
      if (!entity) {
        if (NAV_DEBUG) Logger.log('Enemies', `getNearest → null (entity ${c.objectId} missing)`);
        return null;
      }
      const result = toSdkEnemy(entity, deps.gameData);
      if (NAV_DEBUG) Logger.log('Enemies', `getNearest → "${result.name}" id=${result.objectId} objectType=0x${result.objectType.toString(16)} dist=${distTo(org, result.position)} hp=${result.hp}/${result.maxHp} isBoss=${result.isBoss}`);
      return result;
    };

    Enemies.getNearestTo = (position: Position): Enemy | null => {
      if (!deps.clientRef.current?.connected) return null;
      const c = deps.worldState.getNearestEnemy(deps.gameData, position);
      if (!c) return null;
      const entity = deps.worldState.getEntity(c.objectId);
      if (!entity) return null;
      const result = toSdkEnemy(entity, deps.gameData);
      if (NAV_DEBUG) Logger.log('Enemies', `getNearestTo (${position.x.toFixed(2)},${position.y.toFixed(2)}) → "${result.name}" id=${result.objectId} dist=${distTo(position, result.position)}`);
      return result;
    };

    Enemies.getBoss = (): Enemy | null => {
      if (!deps.clientRef.current?.connected) {
        if (NAV_DEBUG) Logger.log('Enemies', 'getBoss → null (no client)');
        return null;
      }
      const org = origin(deps);
      const bosses = deps.worldState.getBossEventTargetsSorted(deps.gameData, org);
      if (bosses.length === 0) {
        if (NAV_DEBUG) Logger.log('Enemies', 'getBoss → null (no boss entities)');
        return null;
      }
      const entity = deps.worldState.getEntity(bosses[0]!.objectId);
      if (!entity) return null;
      const result = toSdkEnemy(entity, deps.gameData);
      if (NAV_DEBUG) Logger.log('Enemies', `getBoss → "${result.name}" id=${result.objectId} dist=${distTo(org, result.position)} hp=${result.hp}/${result.maxHp} (${bosses.length} boss candidates)`);
      return result;
    };

    Enemies.getTargetingMe = (): Enemy[] => {
      // Not determinable from wire data alone
      return [];
    };

    Enemies.find = (name: string): Enemy | null => {
      if (!deps.clientRef.current?.connected) return null;
      const q = name.trim().toLowerCase();
      if (!q) return null;
      const org = origin(deps);
      const candidates = deps.worldState.getEnemiesMatching(deps.gameData, org);
      for (const c of candidates) {
        const def = deps.gameData.getObject(c.objectType);
        const eName = (def?.displayId || def?.id || '').toLowerCase();
        if (eName.includes(q)) {
          const entity = deps.worldState.getEntity(c.objectId);
          if (entity) {
            const result = toSdkEnemy(entity, deps.gameData);
            if (NAV_DEBUG) Logger.log('Enemies', `find("${name}") → "${result.name}" id=${result.objectId} dist=${distTo(org, result.position)}`);
            return result;
          }
        }
      }
      if (NAV_DEBUG) Logger.log('Enemies', `find("${name}") → null (checked ${candidates.length} candidates)`);
      return null;
    };

    Enemies.count = (): number => {
      if (!deps.clientRef.current?.connected) return 0;
      const n = deps.worldState.getEnemiesMatching(deps.gameData, origin(deps)).length;
      if (NAV_DEBUG) Logger.log('Enemies', `count → ${n}`);
      return n;
    };

    Enemies.getById = (objectId: number): Enemy | null => {
      if (!deps.clientRef.current?.connected) return null;
      const entity = deps.worldState.getEntity(objectId);
      if (!entity) {
        if (NAV_DEBUG) Logger.log('Enemies', `getById(${objectId}) → null (not tracked)`);
        return null;
      }
      const cat = deps.gameData.getObjectCategory(entity.objectType);
      if (cat !== 'Enemy') {
        if (NAV_DEBUG) Logger.log('Enemies', `getById(${objectId}) → null (category="${cat}", not Enemy)`);
        return null;
      }
      const result = toSdkEnemy(entity, deps.gameData);
      const org = origin(deps);
      if (NAV_DEBUG) Logger.log('Enemies', `getById(${objectId}) → "${result.name}" dist=${distTo(org, result.position)} hp=${result.hp}/${result.maxHp}`);
      return result;
    };

    Enemies.getByType = (objectType: number): Enemy[] => {
      if (!deps.clientRef.current?.connected) return [];
      const cat = deps.gameData.getObjectCategory(objectType);
      if (cat !== 'Enemy') {
        if (NAV_DEBUG) Logger.log('Enemies', `getByType(0x${objectType.toString(16)}) → [] (category="${cat}", not Enemy)`);
        return [];
      }
      const candidates = deps.worldState.getEntitiesByTypeSorted(objectType, origin(deps));
      const result: Enemy[] = [];
      for (const c of candidates) {
        const entity = deps.worldState.getEntity(c.objectId);
        if (entity) result.push(toSdkEnemy(entity, deps.gameData));
      }
      if (NAV_DEBUG) {
        const def = deps.gameData.getObject(objectType);
        Logger.log('Enemies', `getByType(0x${objectType.toString(16)} "${def?.id ?? '?'}") → ${result.length} results`);
      }
      return result;
    };
  }
}
