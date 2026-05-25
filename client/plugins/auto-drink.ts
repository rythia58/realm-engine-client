import { readFileSync } from 'fs';
import { resolve } from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { PluginContext } from '../src/plugins/PluginContext.js';
import type { ClientConnection } from '../src/proxy/ClientConnection.js';

/**
 * Auto Drink — autopot from potion belt (slot 1000000+i) + inventory (slots 4-11).
 *
 * Drinks HP/MP pots when current health/mana drops below configurable
 * thresholds. Tries the potion belt first (since belt pots are a stack),
 * falling back to inventory pots.
 *
 * Independent of auto-nexus's drinker — set thresholds high (e.g. HP 70%, MP 50%)
 * so this fires while nexus stays at emergency-tier (HP ~30%).
 */

interface AutoDrinkState {
  lastHpDrinkAt: number;
  lastMpDrinkAt: number;
}

const SAFE_ZONE_MAPS = new Set([
  'Nexus', 'Vault',
  'Guild Hall', 'Guild Hall 2', 'Guild Hall 3', 'Guild Hall 4', 'Guild Hall 5',
  'Cloth Bazaar',
  'Nexus Explanation', 'Vault Explanation', 'Guild Explanation',
  'Daily Quest Room', 'Daily Login Room',
  'Pet Yard', 'Pet Yard 2', 'Pet Yard 3', 'Pet Yard 4', 'Pet Yard 5',
]);

const BELT_SLOT_BASE = 1000000;

function loadPotIds(): { hpPots: Set<number>; mpPots: Set<number> } {
  const hpPots = new Set<number>();
  const mpPots = new Set<number>();
  try {
    const xmlPath = resolve(process.cwd(), 'data', 'objects.xml');
    const xml = readFileSync(xmlPath, 'utf8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (n) => n === 'Object' || n === 'Activate',
    });
    const parsed = parser.parse(xml);
    const objects = Array.isArray(parsed?.Objects?.Object) ? parsed.Objects.Object : [];

    for (const obj of objects) {
      const typeText = String(obj?.['@_type'] || '').trim();
      if (!typeText) continue;
      const itemId = Number.parseInt(typeText.replace(/^0x/i, ''), 16);
      if (!Number.isFinite(itemId)) continue;

      const slotType = Number(obj?.SlotType ?? -1);
      if (slotType === 10) hpPots.add(itemId);
      if (slotType === 26) mpPots.add(itemId);

      const acts = Array.isArray(obj?.Activate) ? obj.Activate : [];
      for (const a of acts) {
        const text = typeof a === 'string' ? a : String(a?.['#text'] || a || '');
        if (text === 'Heal') hpPots.add(itemId);
        if (text === 'Magic') mpPots.add(itemId);
      }
    }
  } catch {
    // Catalog missing — sets stay empty; auto-drink no-ops gracefully.
  }
  return { hpPots, mpPots };
}

export function register(ctx: PluginContext) {
  ctx.name = 'Auto Drink';
  ctx.category = 'automation';

  const { hpPots, mpPots } = loadPotIds();
  const states = new WeakMap<ClientConnection, AutoDrinkState>();

  let enableHp = true;
  let enableMp = true;
  let hpThresholdPct = 70;
  let mpThresholdPct = 50;
  let drinkCooldownMs = 350;
  let preferBelt = true;

  ctx.registerSetting('enableHp', { label: 'Drink HP pots', type: 'boolean', value: enableHp },
    (v: boolean) => { enableHp = v === true; });
  ctx.registerSetting('enableMp', { label: 'Drink MP pots', type: 'boolean', value: enableMp },
    (v: boolean) => { enableMp = v === true; });
  ctx.registerSetting('hpThresholdPct', {
    label: 'HP threshold %', type: 'range', value: hpThresholdPct, min: 10, max: 95, step: 5,
  }, (v: number) => { hpThresholdPct = clampPct(v); });
  ctx.registerSetting('mpThresholdPct', {
    label: 'MP threshold %', type: 'range', value: mpThresholdPct, min: 10, max: 95, step: 5,
  }, (v: number) => { mpThresholdPct = clampPct(v); });
  ctx.registerSetting('drinkCooldownMs', {
    label: 'Drink cooldown (ms)', type: 'number', value: drinkCooldownMs, min: 150, max: 2000, step: 50,
  }, (v: number) => { drinkCooldownMs = Math.max(150, Math.min(2000, Math.trunc(Number(v) || 350))); });
  ctx.registerSetting('preferBelt', { label: 'Prefer potion belt', type: 'boolean', value: preferBelt },
    (v: boolean) => { preferBelt = v === true; });

  function clampPct(v: number): number {
    return Math.max(5, Math.min(95, Math.trunc(Number(v) || 0)));
  }

  function getState(client: ClientConnection): AutoDrinkState {
    let s = states.get(client);
    if (!s) {
      s = { lastHpDrinkAt: 0, lastMpDrinkAt: 0 };
      states.set(client, s);
    }
    return s;
  }

  function inSafeZone(client: ClientConnection): boolean {
    const map = client.playerData.mapName;
    return SAFE_ZONE_MAPS.has(map);
  }

  function findBeltSlot(client: ClientConnection, idSet: Set<number>): { slotId: number; itemType: number } | null {
    const belt = (client.playerData as any).quickSlots ?? [];
    const cap = (client.playerData as any).hasThirdQuickSlot ? 3 : 2;
    for (let i = 0; i < cap && i < belt.length; i++) {
      const s: any = belt[i];
      if (s?.itemType !== -1 && s?.quantity > 0 && idSet.has(s.itemType)) {
        return { slotId: BELT_SLOT_BASE + i, itemType: s.itemType };
      }
    }
    return null;
  }

  function findInventorySlot(client: ClientConnection, idSet: Set<number>): { slotId: number; itemType: number } | null {
    const inv = client.playerData.inventory;
    for (let slot = 4; slot < inv.length; slot++) {
      const itemId = Number(inv[slot] ?? -1);
      if (itemId !== -1 && idSet.has(itemId)) {
        return { slotId: slot, itemType: itemId };
      }
    }
    if (client.playerData.hasBackpack) {
      const bp = client.playerData.backpack;
      for (let slot = 0; slot < 8; slot++) {
        const itemId = Number(bp[slot] ?? -1);
        if (itemId !== -1 && idSet.has(itemId)) {
          return { slotId: 12 + slot, itemType: itemId };
        }
      }
    }
    return null;
  }

  function sendUseItem(client: ClientConnection, slotId: number, itemType: number): void {
    const pos = client.playerData.pos ?? { x: 0, y: 0 };
    const pkt = ctx.createPacket('USEITEM');
    pkt.data = {
      time: client.lastUpdate ?? Math.trunc(client.time ?? 0),
      slotObject: { objectId: client.objectId, slotId, objectType: itemType },
      itemUsePos: { x: pos.x, y: pos.y },
      useType: 1,
      unknownInt: 0,
    };
    pkt.modified = true;
    client.sendToServer(pkt);
  }

  function tryDrink(
    client: ClientConnection,
    state: AutoDrinkState,
    enabled: boolean,
    cur: number,
    max: number,
    thresholdPct: number,
    idSet: Set<number>,
    lastKey: 'lastHpDrinkAt' | 'lastMpDrinkAt',
    label: string,
  ): boolean {
    if (!enabled || max <= 0 || idSet.size === 0) return false;
    if ((cur / max) * 100 > thresholdPct) return false;

    const now = Date.now();
    if (now - state[lastKey] < drinkCooldownMs) return false;

    const found = preferBelt
      ? (findBeltSlot(client, idSet) ?? findInventorySlot(client, idSet))
      : (findInventorySlot(client, idSet) ?? findBeltSlot(client, idSet));
    if (!found) return false;

    sendUseItem(client, found.slotId, found.itemType);
    state[lastKey] = now;
    const where = found.slotId >= BELT_SLOT_BASE ? `belt[${found.slotId - BELT_SLOT_BASE}]` : `inv[${found.slotId}]`;
    ctx.log(`Drink ${label} from ${where}`);
    return true;
  }

  ctx.hookPacket('NEWTICK', (client) => {
    if (!ctx.enabled) return;
    if (!client?.connected || !client.objectId) return;
    if (inSafeZone(client)) return;

    const pd = client.playerData;
    const state = getState(client);

    tryDrink(client, state, enableHp, pd.health, pd.maxHealth, hpThresholdPct, hpPots, 'lastHpDrinkAt', 'HP');
    tryDrink(client, state, enableMp, pd.mana, pd.maxMana, mpThresholdPct, mpPots, 'lastMpDrinkAt', 'MP');
  });

  ctx.hookPacket('MAPINFO', (client) => {
    const s = getState(client);
    s.lastHpDrinkAt = 0;
    s.lastMpDrinkAt = 0;
  });

  ctx.log(`Loaded ${hpPots.size} HP pot ids, ${mpPots.size} MP pot ids.`);
}
