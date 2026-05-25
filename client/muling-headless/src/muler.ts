import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AccountService,
  Client,
  Environment,
  Logger,
  LogLevel,
  pickDefaultServer,
  type CharacterDetail,
} from '@re-headless/core';
import type { VaultContentPacket } from '@re-headless/protocol';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const mainAccountId = getArg('--mainId');
const accountsFile  = getArg('--accounts');
const serversFile   = getArg('--servers');
const cacheDir      = getArg('--cacheDir');

if (!mainAccountId || !accountsFile || !serversFile) {
  console.error('[muler] Usage: muler.js --mainId <id> --accounts <path> --servers <path> [--cacheDir <path>]');
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BotClientAccount {
  id: string;
  label: string;
  email: string;
  password: string;
  serverName: string;
  notes: string;
  mulingRole: 'none' | 'main' | 'mule';
  mulingStoreMode: 'any' | 'specific';
  mulingItemsToStore: string;
  mulingItemsFromMain: string;
  mulingItemsToMuleOff: string;
  proxy: string;
  proxyUsername: string;
  proxyPassword: string;
  [key: string]: unknown;
}

interface MulingStatus {
  phase: string;
  main: { name: string; status: string; pots: number; charId?: number };
  mules: Array<{ name: string; status: string; deposited: number }>;
}

// ── Status output ─────────────────────────────────────────────────────────────

let _status: MulingStatus = {
  phase: 'starting',
  main: { name: '', status: 'Connecting…', pots: 0 },
  mules: [],
};

function emitStatus(update: Partial<MulingStatus>): void {
  _status = { ..._status, ...update };
  // DevServer reads lines prefixed MULING_STATUS: from stdout
  process.stdout.write('MULING_STATUS:' + JSON.stringify(_status) + '\n');
}

function setMainStatus(status: string, pots?: number): void {
  emitStatus({ main: { ..._status.main, status, ...(pots !== undefined ? { pots } : {}) } });
}

function setMuleStatus(index: number, status: string, deposited?: number): void {
  const mules = [..._status.mules];
  if (mules[index]) {
    mules[index] = { ...mules[index]!, status, ...(deposited !== undefined ? { deposited } : {}) };
    emitStatus({ mules });
  }
}

// ── Stat pot IDs ──────────────────────────────────────────────────────────────

const STAT_POT_IDS: Record<string, number[]> = {
  'atk':  [2591, 9064],
  'def':  [2592, 9065],
  'spd':  [2593, 9066],
  'dex':  [2636, 9069],
  'vit':  [2612, 9067],
  'wis':  [2613, 9068],
  'life': [2793, 9070],
  'mana': [2794, 9071],
};
const ALL_STAT_POT_IDS = new Set(Object.values(STAT_POT_IDS).flat());

function parseTargetItemIds(raw: string): Set<number> {
  if (!raw || !raw.trim()) return new Set<number>();
  const ids = new Set<number>();
  for (const tok of raw.split(',')) {
    const n = parseInt(tok.trim(), 10);
    if (!isNaN(n)) ids.add(n);
  }
  return ids;
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadAccounts(): BotClientAccount[] {
  const raw = JSON.parse(readFileSync(accountsFile!, 'utf8')) as { accounts?: unknown[] };
  return (Array.isArray(raw?.accounts) ? raw.accounts : []) as BotClientAccount[];
}

function loadServers(): Record<string, string> {
  if (existsSync(serversFile!)) {
    return JSON.parse(readFileSync(serversFile!, 'utf8')) as Record<string, string>;
  }
  return {};
}

// ── Cache reading ─────────────────────────────────────────────────────────────

interface CachedCharacter {
  charId: number;
  seasonal: boolean;
  level: number;
}

/**
 * Read the saved character overview for an account from the bot-client cache dir.
 * Returns null if no cache exists or it can't be parsed.
 */
function readCachedCharacters(accountId: string): CachedCharacter[] | null {
  if (!cacheDir) return null;
  try {
    const filePath = `${cacheDir}/${accountId}.json`;
    if (!existsSync(filePath)) return null;
    const record = JSON.parse(readFileSync(filePath, 'utf8')) as {
      overview?: { characters?: Array<{ charId?: number; seasonal?: boolean; level?: number }> };
    };
    const chars = record?.overview?.characters;
    if (!Array.isArray(chars)) return null;
    return chars.map((c) => ({
      charId: Number(c.charId ?? 0),
      seasonal: Boolean(c.seasonal),
      level: Number(c.level ?? 0),
    }));
  } catch {
    return null;
  }
}

/**
 * Returns true if the account has at least one non-seasonal character (according to cached data).
 * Returns null if no cache is available (can't pre-check).
 */
function cachedHasNonSeasonalChar(accountId: string): boolean | null {
  const chars = readCachedCharacters(accountId);
  if (chars === null) return null;
  return chars.some((c) => !c.seasonal);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEvent<K extends keyof import('@re-headless/core').ClientEvents>(
  client: Client,
  event: K,
  timeoutMs = 30_000,
): Promise<import('@re-headless/core').ClientEvents[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, handler as never);
      reject(new Error(`Timeout waiting for ${String(event)} on ${client.alias}`));
    }, timeoutMs);
    const handler = (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as import('@re-headless/core').ClientEvents[K]);
    };
    client.once(event, handler as never);
  });
}

async function waitForMap(client: Client, mapContains: string, timeoutMs = 45_000): Promise<void> {
  const cur = client.currentMapLabel ?? '';
  if (cur.toLowerCase().includes(mapContains.toLowerCase())) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('mapChanged', mapHandler);
      client.off('disconnected', discHandler);
      reject(new Error(`Timeout waiting for map "${mapContains}" on ${client.alias}`));
    }, timeoutMs);
    const mapHandler = (name: string) => {
      if (name.toLowerCase().includes(mapContains.toLowerCase())) {
        clearTimeout(timer);
        client.off('mapChanged', mapHandler);
        client.off('disconnected', discHandler);
        resolve();
      }
    };
    const discHandler = () => {
      clearTimeout(timer);
      client.off('mapChanged', mapHandler);
      client.off('disconnected', discHandler);
      reject(new Error(`Disconnected while waiting for map "${mapContains}" on ${client.alias}`));
    };
    client.on('mapChanged', mapHandler);
    client.on('disconnected', discHandler);
  });
}

async function waitForVaultContent(client: Client, timeoutMs = 30_000): Promise<VaultContentPacket> {
  const [pkt] = await waitForEvent(client, 'vaultContent', timeoutMs);
  return pkt as VaultContentPacket;
}

async function waitForCharacterName(client: Client, timeoutMs = 30_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (client.characterName) return client.characterName;
    await delay(200);
  }
  throw new Error(`Timeout waiting for characterName on ${client.alias}`);
}

async function waitForInvResult(client: Client, timeoutMs = 10_000): Promise<void> {
  await waitForEvent(client, 'invResult', timeoutMs);
}

const VAULT_CHEST_OBJECT_TYPE = 1284;
const VAULT_CHEST_INTERACT_DIST = 0.5;

async function walkToVaultChest(client: Client, timeoutMs = 15_000): Promise<void> {
  const chestOid = client.vaultChestObjectId;
  if (chestOid <= 0) return;
  const pos = client.getEntityPosition(chestOid);
  if (!pos) {
    console.log(`[muler] Vault chest oid=${chestOid} not in entity tracker yet, skipping walk`);
    return;
  }
  client.setWalkTarget(pos);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = client.position;
    if (p) {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d <= VAULT_CHEST_INTERACT_DIST) {
        client.setWalkTarget(undefined);
        console.log(`[muler] Reached vault chest (dist=${d.toFixed(3)})`);
        return;
      }
    }
    await delay(100);
  }
  client.setWalkTarget(undefined);
  console.log(`[muler] Walk to vault chest timed out, proceeding anyway`);
}

// ── Account connection ────────────────────────────────────────────────────────

/**
 * Pick the best character to connect on.
 * Prefers non-seasonal characters (highest level first); falls back to seasonal if none exist.
 */
function pickBestChar(characters: CharacterDetail[] | undefined): CharacterDetail | undefined {
  if (!characters || characters.length === 0) return undefined;
  const nonSeasonal = characters.filter((c) => !c.isSeasonal);
  if (nonSeasonal.length > 0) {
    nonSeasonal.sort((a, b) => b.level - a.level);
    return nonSeasonal[0];
  }
  const seasonal = characters.filter((c) => c.isSeasonal);
  seasonal.sort((a, b) => b.level - a.level);
  return seasonal[0];
}

async function connectAccount(
  acc: BotClientAccount,
  servers: Record<string, string>,
  gameVersion: string,
  role: string,
  overrideHost?: string,
  autoEnterVault = true,
): Promise<Client> {
  const passwordOrSecret = acc.password ?? '';
  const clientToken = AccountService.makeClientToken(acc.email, passwordOrSecret);
  const svc = new AccountService();

  const { accessToken } = await svc.verify({ guid: acc.email, password: acc.password, clientToken });
  await svc.verifyToken({ accessToken, clientToken });
  const charInfo = await svc.charList({ accessToken });

  // Pick the best character (non-seasonal preferred, falls back to seasonal)
  const bestChar = pickBestChar(charInfo.characters);
  if (!bestChar) {
    throw new Error(
      `[muler:${role}] ${acc.label || acc.email} has no characters. ` +
      `(nextCharId=${charInfo.nextCharId})`
    );
  }
  const charId = bestChar.charId;
  const isSeasonal = bestChar.isSeasonal;
  const gameId = charInfo.inTutorial ? -1 : -2;

  let host: string;
  let serverLabel: string = acc.serverName || 'USWest';

  if (overrideHost) {
    host = overrideHost;
    serverLabel = acc.serverName || serverLabel;
  } else {
    const serverKey = acc.serverName?.trim();
    if (serverKey && servers[serverKey]) {
      host = servers[serverKey];
      serverLabel = serverKey;
    } else {
      const serverList = await svc.getServers({ accessToken });
      const picked = pickDefaultServer(serverList);
      host = picked.host;
      serverLabel = picked.key;
    }
  }

  console.log(`[muler:${role}] ${acc.label || acc.email} → ${serverLabel} (${host}) charId=${charId} seasonal=${isSeasonal}`);

  const client = new Client({
    alias: acc.label || acc.email,
    host,
    port: 2050,
    serverLabel,
    buildVersion: gameVersion,
    accessToken,
    clientToken,
    gameId,
    keyTime: -1,
    key: Buffer.alloc(0),
    charId,
    needsNewChar: charInfo.needsNewChar,
    autoEnterVault,
    createChar: { isSeasonal, isChallenger: false, isBonus: false },
    onDisconnected: (c) => {
      console.log(`[muler:${role}] ${c.alias} disconnected`);
    },
  });

  await client.connect();
  return client;
}

// ── Vault interaction ─────────────────────────────────────────────────────────

/**
 * Load target pots from vault into inventory (slots 4-11) and push any
 * non-target items already in inventory back to vault.
 * Returns the number of target pots now in inventory.
 */
async function prepareMainInventory(
  client: Client,
  targetIds: Set<number>,
  vaultContents: number[],
): Promise<number> {
  const playerOid = client.playerObjectId;
  const vaultOid = client.vaultChestObjectId;

  if (vaultOid <= 0) throw new Error('Vault chest objectId unknown');

  // Track local copies so we don't need to wait for stats update between sends
  const localInv = [...client.inventoryStrip.mainStorage8];
  const localVault = [...vaultContents];

  // Step 1: push non-target items from inventory back to vault
  for (let i = 0; i < 8; i++) {
    const itemType = localInv[i]!;
    if (itemType < 0 || targetIds.has(itemType)) continue;
    // Find an empty vault slot
    const vSlot = localVault.findIndex(v => v < 0);
    if (vSlot < 0) break; // vault full
    const invSlot = i + 4;
    client.sendInvSwap(
      { objectId: playerOid, slotId: invSlot, objectType: itemType },
      { objectId: vaultOid, slotId: vSlot, objectType: -1 },
    );
    localVault[vSlot] = itemType;
    localInv[i] = -1;
    await delay(500);
    await waitForInvResult(client, 8_000).catch(() => {/* best effort */});
  }

  // Step 2: pull target pots from vault into empty inventory slots
  const emptyInvIndices = localInv.map((v, i) => v < 0 ? i : -1).filter(i => i >= 0);
  const vaultPotSlots: Array<{ vSlot: number; itemType: number }> = [];
  for (let i = 0; i < localVault.length; i++) {
    if (targetIds.has(localVault[i]!)) vaultPotSlots.push({ vSlot: i, itemType: localVault[i]! });
  }

  let pulled = 0;
  for (let i = 0; i < Math.min(emptyInvIndices.length, vaultPotSlots.length); i++) {
    const emptyIdx = emptyInvIndices[i]!;
    const { vSlot, itemType } = vaultPotSlots[i]!;
    const invSlot = emptyIdx + 4;
    client.sendInvSwap(
      { objectId: vaultOid, slotId: vSlot, objectType: itemType },
      { objectId: playerOid, slotId: invSlot, objectType: -1 },
    );
    localInv[emptyIdx] = itemType;
    localVault[vSlot] = -1;
    pulled++;
    await delay(500);
    await waitForInvResult(client, 8_000).catch(() => {/* best effort */});
  }

  return localInv.filter(v => targetIds.has(v!)).length;
}

/**
 * Mule deposits all items from inventory slots 4-11 into vault.
 * Returns number deposited.
 */
async function depositMuleInventory(client: Client): Promise<number> {
  const playerOid = client.playerObjectId;
  const vaultOid = client.vaultChestObjectId;
  const vaultContents = client.vaultContents;

  if (vaultOid <= 0) throw new Error('Vault chest objectId unknown');

  const inv = client.inventoryStrip.mainStorage8;
  const localInv = [...inv];
  const localVault = [...vaultContents];

  let deposited = 0;
  for (let i = 0; i < 8; i++) {
    const itemType = localInv[i]!;
    if (itemType < 0) continue;
    const vSlot = localVault.findIndex(v => v < 0);
    if (vSlot < 0) {
      console.log(`[muler:mule] ${client.alias} vault full after ${deposited} deposits`);
      break;
    }
    const invSlot = i + 4;
    client.sendInvSwap(
      { objectId: playerOid, slotId: invSlot, objectType: itemType },
      { objectId: vaultOid, slotId: vSlot, objectType: -1 },
    );
    localVault[vSlot] = itemType;
    localInv[i] = -1;
    deposited++;
    await delay(500);
    await waitForInvResult(client, 8_000).catch(() => {/* best effort */});
  }
  return deposited;
}

// ── Trade coordination ────────────────────────────────────────────────────────

function countTargetPots(inv: number[], targetIds: Set<number>): { slots: number[]; count: number } {
  const slots: number[] = [];
  for (let i = 0; i < inv.length; i++) {
    if (targetIds.has(inv[i]!)) slots.push(i + 4); // +4 because mainStorage8 starts at slot 4
  }
  return { slots, count: slots.length };
}

function countFreeInvSlots(inv: number[]): number[] {
  const free: number[] = [];
  for (let i = 0; i < inv.length; i++) {
    if (inv[i]! < 0) free.push(i + 4);
  }
  return free;
}

function countFreeVaultSlots(vault: number[]): number {
  return vault.filter(v => v < 0).length;
}

/**
 * Execute one trade round between main and mule.
 * Main offers `slotsToOffer` (indices into TRADESTART clientItems = full 12-slot inv).
 * Mule accepts everything.
 * Returns true if TRADEDONE code === 0 (success).
 */
async function executeTrade(
  main: Client,
  mule: Client,
  potSlots: number[],  // actual inv slot indices (4-11) on main that have target pots
  maxToTrade: number,
  timeoutMs = 60_000,
): Promise<boolean> {
  const muleCharName = await waitForCharacterName(mule, 20_000);
  const mainCharName = await waitForCharacterName(main, 20_000);

  console.log(`[muler:trade] main=${mainCharName} mule=${muleCharName} offering ${Math.min(potSlots.length, maxToTrade)} pots`);

  const slotsToOffer = potSlots.slice(0, maxToTrade);
  // Capture the item types in those slots so we can verify the transfer afterwards
  const offeredItemTypes = slotsToOffer
    .map(s => main.inventoryStrip.mainStorage8[s - 4] ?? -1)
    .filter(t => t >= 0);

  // Enable verbose incoming-packet logging on both clients during the trade
  main.tradeDebugLogging = true;
  mule.tradeDebugLogging = true;

  return new Promise<boolean>((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error('Trade timed out'));
    }, timeoutMs);

    let muleOwnSlotCount = 0;
    let resolved = false;

    function done(result: boolean): void {
      if (resolved) return;
      resolved = true;
      cleanup();
      clearTimeout(deadline);
      main.tradeDebugLogging = false;
      mule.tradeDebugLogging = false;
      resolve(result);
    }

    function cleanup(): void {
      if (mainAcceptFallbackTimer) {
        clearTimeout(mainAcceptFallbackTimer);
        mainAcceptFallbackTimer = undefined;
      }
      if (verifyTimer) {
        clearTimeout(verifyTimer);
        verifyTimer = undefined;
      }
      main.off('tradeStart', mainOnTradeStart);
      main.off('tradeChanged', mainOnTradeChanged);
      main.off('tradeAccepted', mainOnTradeAccepted);
      main.off('tradeDone', mainOnTradeDone);
      mule.off('tradeRequested', muleOnTradeRequested);
      mule.off('tradeStart', muleOnTradeStart);
      mule.off('tradeChanged', muleOnTradeChanged);
      mule.off('tradeAccepted', muleOnTradeAccepted);
      mule.off('tradeDone', muleTradeDone);
    }

    // State shared between main's TRADESTART and TRADEACCEPTED handlers
    let mainOffer: boolean[] = [];
    let mainPartnerSlots = 0;
    let mainAcceptSent = false;
    let mainAcceptFallbackTimer: NodeJS.Timeout | undefined;

    function sendMainAccept(reason: string, partnerOffer?: boolean[]): void {
      if (mainAcceptSent) return;
      mainAcceptSent = true;
      if (mainAcceptFallbackTimer) {
        clearTimeout(mainAcceptFallbackTimer);
        mainAcceptFallbackTimer = undefined;
      }
      const pOffer = partnerOffer ?? new Array<boolean>(mainPartnerSlots).fill(false);
      const pTrue = pOffer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:main] ${main.alias} sending ACCEPTTRADE (reason=${reason}) clientOffer_slots=[${mainOffer.map((v,i)=>v?i:null).filter(v=>v!==null).join(',')}] partnerOffer_slots=[${pTrue.join(',')}] partnerOffer_len=${pOffer.length}`);
      main.sendAcceptTrade(mainOffer, pOffer);
    }

    // Mule: TRADEREQUESTED — respond to kick off TRADESTART on both sides
    const muleOnTradeRequested = (name: string) => {
      if (name !== mainCharName) return;
      console.log(`[muler:mule] ${mule.alias} got TRADEREQUESTED from ${name}, accepting`);
      mule.sendRequestTrade(mainCharName);
    };
    mule.on('tradeRequested', muleOnTradeRequested);

    // Mule: TRADESTART — record own slot count
    const muleOnTradeStart = (pkt: import('@re-headless/protocol').TradeStartPacket) => {
      muleOwnSlotCount = pkt.clientItems.length;
      console.log(`[muler:mule] ${mule.alias} TRADESTART partner=${pkt.partnerName} ownSlots=${muleOwnSlotCount}`);
    };
    mule.on('tradeStart', muleOnTradeStart);

    // Mule: TRADECHANGED — main made their offer; accept first so server propagates TRADEACCEPTED to main
    const muleOnTradeChanged = (offer: boolean[]) => {
      const trueIdx = offer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:mule] ${mule.alias} TRADECHANGED partner_offer_slots=[${trueIdx.join(',')}] partner_offer_len=${offer.length} muleOwnSlotCount=${muleOwnSlotCount} → sending ACCEPTTRADE`);
      const emptyOffer = new Array<boolean>(muleOwnSlotCount).fill(false);
      mule.sendAcceptTrade(emptyOffer, offer);
    };
    mule.on('tradeChanged', muleOnTradeChanged);

    // Mule: TRADEACCEPTED — server tells mule that main also accepted.
    // On this server build TRADEDONE never seems to arrive; verify item transfer
    // by polling mule's inventory for the offered item types.
    const muleOnTradeAccepted = (clientOffer: boolean[], partnerOffer: boolean[]) => {
      const cTrue = clientOffer.map((v, i) => v ? i : null).filter(v => v !== null);
      const pTrue = partnerOffer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:mule] ${mule.alias} TRADEACCEPTED (main accepted) clientOffer=[${cTrue.join(',')}] (len=${clientOffer.length}) partnerOffer=[${pTrue.join(',')}] (len=${partnerOffer.length})`);
      console.log(`[muler:mule] ${mule.alias} TRADEACCEPTED received but no TRADEDONE expected — verifying inventory transfer for offered items=[${offeredItemTypes.join(',')}]`);
      verifyTradeByInventoryPoll();
    };
    mule.on('tradeAccepted', muleOnTradeAccepted);

    // Poll mule's inventory for up to 5s after TRADEACCEPTED. If we see any of the
    // offered item types appear, the trade actually completed.
    let verifyTimer: NodeJS.Timeout | undefined;
    function verifyTradeByInventoryPoll(): void {
      const startedAt = Date.now();
      const startInv = [...mule.inventoryStrip.mainStorage8];
      console.log(`[muler:verify] mule inv at TRADEACCEPTED: [${startInv.join(',')}]`);
      const tick = (): void => {
        if (resolved) return;
        const inv = mule.inventoryStrip.mainStorage8;
        const found = offeredItemTypes.some(t => inv.includes(t));
        if (found) {
          console.log(`[muler:verify] mule inv now contains offered item(s) → trade succeeded inv=[${inv.join(',')}]`);
          done(true);
          return;
        }
        if (Date.now() - startedAt >= 5000) {
          console.log(`[muler:verify] timed out waiting for offered items in mule inv=[${inv.join(',')}] — treating as failure`);
          done(false);
          return;
        }
        verifyTimer = setTimeout(tick, 250);
      };
      tick();
    }

    // Mule: TRADEDONE
    const muleTradeDone = (code: number, desc: string) => {
      console.log(`[muler:mule] ${mule.alias} TRADEDONE code=${code} desc=${desc}`);
      if (code === 0) done(true);
      else done(false);
    };
    mule.on('tradeDone', muleTradeDone);

    // Main: TRADESTART — send CHANGETRADE only; wait for mule to accept before we accept
    const mainOnTradeStart = (pkt: import('@re-headless/protocol').TradeStartPacket) => {
      console.log(`[muler:main] ${main.alias} TRADESTART partner=${pkt.partnerName} ourSlots=${pkt.clientItems.length} theirSlots=${pkt.partnerItems.length} slotsToOffer=[${slotsToOffer.join(',')}] potSlots=[${potSlots.join(',')}] maxToTrade=${maxToTrade}`);
      // Detail: what's in each of our slots
      for (let i = 0; i < pkt.clientItems.length; i++) {
        const it = pkt.clientItems[i]!;
        if (it.item >= 0 || slotsToOffer.includes(i)) {
          console.log(`[muler:main]   slot[${i}] id=${it.item} slotType=${it.slotType} tradeable=${it.tradeable} included=${it.included} willOffer=${slotsToOffer.includes(i)}`);
        }
      }
      const offer = new Array<boolean>(pkt.clientItems.length).fill(false);
      let offered = 0;
      const skippedNotTradeable: number[] = [];
      for (let i = 0; i < pkt.clientItems.length && offered < maxToTrade; i++) {
        const item = pkt.clientItems[i]!;
        if (slotsToOffer.includes(i)) {
          if (item.tradeable) {
            offer[i] = true;
            offered++;
          } else {
            skippedNotTradeable.push(i);
          }
        }
      }
      if (skippedNotTradeable.length > 0) {
        console.log(`[muler:main] WARN: skipped slots [${skippedNotTradeable.join(',')}] because tradeable=false`);
      }
      mainOffer = offer;
      mainPartnerSlots = pkt.partnerItems.length;
      const trueIdx = offer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:main] sending CHANGETRADE offer slots=[${trueIdx.join(',')}] len=${offer.length}`);
      main.sendChangeTrade(offer);
      // Fallback: if TRADEACCEPTED never arrives, send ACCEPTTRADE anyway after 1500ms
      mainAcceptFallbackTimer = setTimeout(() => {
        sendMainAccept('fallback-timeout');
      }, 1500);
    };
    main.on('tradeStart', mainOnTradeStart);

    // Main: TRADECHANGED — server echoes our own change OR partner's change
    const mainOnTradeChanged = (offer: boolean[]) => {
      const trueIdx = offer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:main] ${main.alias} TRADECHANGED (debug) offer_slots=[${trueIdx.join(',')}] len=${offer.length}`);
    };
    main.on('tradeChanged', mainOnTradeChanged);

    // Main: TRADEACCEPTED — mule has accepted; now we can accept to complete the trade
    const mainOnTradeAccepted = (clientOffer: boolean[], partnerOffer: boolean[]) => {
      const cTrue = clientOffer.map((v, i) => v ? i : null).filter(v => v !== null);
      const pTrue = partnerOffer.map((v, i) => v ? i : null).filter(v => v !== null);
      console.log(`[muler:main] ${main.alias} TRADEACCEPTED (mule accepted) clientOffer=[${cTrue.join(',')}] (len=${clientOffer.length}) partnerOffer=[${pTrue.join(',')}] (len=${partnerOffer.length})`);
      sendMainAccept('TRADEACCEPTED', partnerOffer);
    };
    main.on('tradeAccepted', mainOnTradeAccepted);

    // Main: TRADEDONE
    const mainOnTradeDone = (code: number, desc: string) => {
      console.log(`[muler:main] ${main.alias} TRADEDONE code=${code} desc=${desc}`);
      if (code === 0) done(true);
      else done(false);
    };
    main.on('tradeDone', mainOnTradeDone);

    // Kick off: main sends REQUESTTRADE to mule
    main.sendRequestTrade(muleCharName);
  });
}

// ── Main orchestration ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  Logger.setMinLevel(LogLevel.Info);

  const accounts = loadAccounts();
  const servers = loadServers();

  const mainAcc = accounts.find((a) => a.id === mainAccountId);
  if (!mainAcc) {
    console.error(`[muler] Main account ${mainAccountId!} not found.`);
    process.exit(1);
  }

  const mules = accounts.filter((a) => a.mulingRole === 'mule');
  if (mules.length === 0) {
    console.warn('[muler] No mule accounts configured.');
    process.exit(0);
  }

  // Parse target item IDs from main's mulingItemsToMuleOff
  const targetIds = parseTargetItemIds(mainAcc.mulingItemsToMuleOff ?? '');
  if (targetIds.size === 0) {
    // If no specific items listed, default to all stat pots
    for (const id of ALL_STAT_POT_IDS) targetIds.add(id);
  }
  console.log(`[muler] Target item IDs: [${[...targetIds].join(',')}]`);

  // Game version — Documents copy takes priority so it can be updated without a client push.
  const gameVersionCandidates = [
    process.env.GAME_VERSION_FILE,
    join(process.env.USERPROFILE || homedir(), 'Documents', 'Realmengine', 'gameVersion.txt'),
    new URL('../../../data/gameVersion.txt', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  ].filter(Boolean) as string[];
  let gameVersion = process.env.GAME_VERSION ?? '6.9.0.1.0';
  for (const p of gameVersionCandidates) {
    if (existsSync(p)) { gameVersion = readFileSync(p, 'utf8').trim() || gameVersion; break; }
  }
  console.log(`[muler] Game version: ${gameVersion}`);

  // Validate: mules with no seasonal chars will throw in connectAccount; warn early
  console.log(`[muler] Main: ${mainAcc.label || mainAcc.email}  |  Mules: ${mules.map((m) => m.label || m.email).join(', ')}`);
  console.log('[muler] Mode: picks highest-level non-seasonal char (falls back to seasonal)');

  // Initialise status
  emitStatus({
    phase: 'starting',
    main: { name: mainAcc.label || mainAcc.email, status: 'Connecting…', pots: 0 },
    mules: mules.map(m => ({ name: m.label || m.email, status: 'Waiting', deposited: 0 })),
  });

  // ── Phase 1: Main enters vault ──────────────────────────────────────────

  setMainStatus('Connecting…');
  const mainClient = await connectAccount(mainAcc, servers, gameVersion, 'main', undefined, true);
  const mainHost = mainClient.host;

  // charId is known immediately after connect (set from charList before connecting)
  const charIdVal = mainClient.activeCharId;
  if (charIdVal >= 0) {
    emitStatus({ main: { ..._status.main, charId: charIdVal } });
  }

  setMainStatus('Entering vault…');
  await waitForMap(mainClient, 'vault', 45_000);
  console.log('[muler] Main in vault');

  setMainStatus('Waiting for vault contents…');
  const vaultPkt = await waitForVaultContent(mainClient, 20_000);
  console.log(`[muler] Vault contents received: ${vaultPkt.vaultContents.length} slots`);

  setMainStatus('Walking to vault chest…');
  await walkToVaultChest(mainClient);
  setMainStatus('Loading pots from vault…');
  const potCount = await prepareMainInventory(mainClient, targetIds, vaultPkt.vaultContents);
  console.log(`[muler] Main loaded ${potCount} target pots`);

  if (potCount === 0) {
    console.log('[muler] No target pots in vault. Disconnecting.');
    setMainStatus('No target pots found');
    mainClient.disconnect();
    return;
  }

  setMainStatus('Going to nexus…', potCount);
  mainClient.cancelAutoVaultEntry();
  mainClient.sendEscape();
  await waitForMap(mainClient, 'nexus', 30_000);
  // Wait for UPDATE stats to arrive so invMain is populated before we read inventory
  await waitForCharacterName(mainClient, 20_000).catch(() => {/* non-fatal */});
  console.log('[muler] Main in nexus, ready to trade');
  setMainStatus('In nexus — ready to trade', potCount);

  emitStatus({ phase: 'trading' });

  // ── Phase 2: Trade with mules sequentially ──────────────────────────────

  for (let muleIdx = 0; muleIdx < mules.length; muleIdx++) {
    const muleAcc = mules[muleIdx]!;

    // Check if main still has pots
    const mainInv = mainClient.inventoryStrip.mainStorage8;
    const { slots: potSlots, count: potsLeft } = countTargetPots(mainInv, targetIds);
    if (potsLeft === 0) {
      console.log('[muler] Main has no more pots. Done.');
      setMainStatus('All pots muled off', 0);
      break;
    }
    setMainStatus('Trading…', potsLeft);

    // Pre-flight: check cached character data before connecting
    const hasNonSeasonal = cachedHasNonSeasonalChar(muleAcc.id);
    if (hasNonSeasonal === false) {
      console.log(`[muler] Skipping mule ${muleAcc.label || muleAcc.email} — no non-seasonal characters (cached)`);
      setMuleStatus(muleIdx, 'Skipped (no non-seasonal char)');
      continue;
    }
    if (hasNonSeasonal === null) {
      console.log(`[muler] No cache for mule ${muleAcc.label || muleAcc.email} — connecting to check`);
    }

    setMuleStatus(muleIdx, 'Connecting…');

    // Connect mule with retry on ECONNRESET / handshake failure
    const MAX_MULE_CONNECT_ATTEMPTS = 3;
    let muleClient: Client | undefined;
    let lastConnectErr: Error | undefined;
    for (let attempt = 1; attempt <= MAX_MULE_CONNECT_ATTEMPTS; attempt++) {
      try {
        muleClient = await connectAccount(muleAcc, servers, gameVersion, `mule[${muleIdx}]`, mainHost, false);
        // Wait briefly for the connection to stabilize and pick up MapInfo (or fail).
        await waitForMap(muleClient, 'nexus', 15_000);
        break;
      } catch (err) {
        lastConnectErr = err as Error;
        console.log(`[muler] Mule connect attempt ${attempt}/${MAX_MULE_CONNECT_ATTEMPTS} failed: ${lastConnectErr.message}`);
        try { muleClient?.disconnect(); } catch { /* ignore */ }
        muleClient = undefined;
        if (attempt < MAX_MULE_CONNECT_ATTEMPTS) {
          const backoff = 3000 + attempt * 2000;
          console.log(`[muler] Retrying mule connect in ${backoff}ms…`);
          setMuleStatus(muleIdx, `Connect failed — retry in ${Math.round(backoff/1000)}s`);
          await delay(backoff);
        }
      }
    }
    if (!muleClient) {
      console.log(`[muler] Mule ${muleAcc.label || muleAcc.email} could not connect after ${MAX_MULE_CONNECT_ATTEMPTS} attempts: ${lastConnectErr?.message}`);
      setMuleStatus(muleIdx, `Connect failed: ${lastConnectErr?.message ?? 'unknown'}`);
      continue;
    }

    // Post-connect check: if pickBestChar picked a seasonal char, skip this mule
    if (muleClient.activeCharId >= 0) {
      const cachedChars = readCachedCharacters(muleAcc.id);
      const loadedChar = cachedChars?.find((c) => c.charId === muleClient!.activeCharId);
      if (loadedChar?.seasonal) {
        console.log(`[muler] Mule ${muleAcc.label || muleAcc.email} loaded charId=${muleClient.activeCharId} which is seasonal — skipping`);
        setMuleStatus(muleIdx, 'Skipped (seasonal char only)');
        muleClient.disconnect();
        continue;
      }
    }

    setMuleStatus(muleIdx, 'In nexus — waiting for trade');
    console.log(`[muler] Mule ${muleAcc.label || muleAcc.email} in nexus`);

    // Calculate capacity: how many pots the mule can receive
    const muleInv = muleClient.inventoryStrip.mainStorage8;
    const muleFreeInvSlots = countFreeInvSlots(muleInv);
    const maxToTrade = Math.min(potsLeft, muleFreeInvSlots.length);

    if (maxToTrade === 0) {
      console.log(`[muler] Mule ${muleAcc.label} inventory full, skipping`);
      setMuleStatus(muleIdx, 'Inventory full — skipping');
      muleClient.disconnect();
      continue;
    }

    setMuleStatus(muleIdx, `Trading (${maxToTrade} pots)…`);
    setMainStatus(`Trading ${maxToTrade} pots with ${muleAcc.label || muleAcc.email}…`, potsLeft);

    let tradeSuccess = false;
    try {
      tradeSuccess = await executeTrade(mainClient, muleClient, potSlots, maxToTrade);
    } catch (err) {
      console.error(`[muler] Trade error: ${(err as Error).message}`);
      setMuleStatus(muleIdx, `Trade failed: ${(err as Error).message}`);
      muleClient.disconnect();
      continue;
    }

    if (!tradeSuccess) {
      console.log('[muler] Trade cancelled or failed, moving to next mule');
      setMuleStatus(muleIdx, 'Trade failed');
      muleClient.disconnect();
      continue;
    }

    setMuleStatus(muleIdx, 'Trade success — entering vault…');
    console.log(`[muler] Trade complete. Mule entering vault to deposit.`);

    // Mule: enter vault and deposit
    muleClient.enterVault();
    await waitForMap(muleClient, 'vault', 45_000);

    setMuleStatus(muleIdx, 'In vault — depositing…');
    const muleVaultPkt = await waitForVaultContent(muleClient, 20_000);
    const freeVaultSlots = countFreeVaultSlots(muleVaultPkt.vaultContents);
    console.log(`[muler] Mule vault has ${freeVaultSlots} free slots`);

    await walkToVaultChest(muleClient);
    const deposited = await depositMuleInventory(muleClient);
    console.log(`[muler] Mule deposited ${deposited} items`);
    setMuleStatus(muleIdx, `Deposited ${deposited} pots`, deposited);

    muleClient.disconnect();

    // Update main pot count
    const newPotSlots = countTargetPots(mainClient.inventoryStrip.mainStorage8, targetIds);
    setMainStatus(`${newPotSlots.count} pots remaining`, newPotSlots.count);

    if (newPotSlots.count === 0) break;
  }

  emitStatus({ phase: 'done' });
  const remaining = countTargetPots(mainClient.inventoryStrip.mainStorage8, targetIds).count;
  setMainStatus(remaining > 0 ? `Done — ${remaining} pots remain (no more mules)` : 'All pots muled off!', remaining);
  console.log('[muler] Muling complete. Disconnecting main.');
  mainClient.disconnect();
}

main().catch((err) => {
  console.error('[muler] Fatal error:', err);
  emitStatus({ phase: 'error', main: { ..._status.main, status: `Error: ${(err as Error).message}` } });
  process.exit(1);
});
