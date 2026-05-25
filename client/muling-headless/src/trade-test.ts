import { readFileSync, existsSync } from 'node:fs';
import { AccountService, Client, pickDefaultServer } from '@re-headless/core';
import type { TradeStartPacket } from '@re-headless/protocol';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const accountId  = getArg('--accountId');
const accountsFile = getArg('--accounts');
const serversFile  = getArg('--servers');

if (!accountId || !accountsFile || !serversFile) {
  console.error('Usage: trade-test.js --accountId <id> --accounts <path> --servers <path>');
  process.exit(1);
}

interface BotClientAccount {
  id: string; label: string; email: string; password: string; serverName: string;
  [key: string]: unknown;
}

function loadAccounts(): BotClientAccount[] {
  const raw = JSON.parse(readFileSync(accountsFile!, 'utf8')) as { accounts?: unknown[] };
  return (Array.isArray(raw?.accounts) ? raw.accounts : []) as BotClientAccount[];
}

function loadServers(): Record<string, string> {
  if (existsSync(serversFile!)) return JSON.parse(readFileSync(serversFile!, 'utf8')) as Record<string, string>;
  return {};
}

async function main() {
  const accounts = loadAccounts();
  const servers = loadServers();
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) { console.error(`Account ${accountId!} not found`); process.exit(1); }

  const gameVersion = '6.9.0.1.0';

  const clientToken = AccountService.makeClientToken(acc.email, acc.password);
  const svc = new AccountService();
  const { accessToken } = await svc.verify({ guid: acc.email, password: acc.password, clientToken });
  await svc.verifyToken({ accessToken, clientToken });
  const charInfo = await svc.charList({ accessToken });

  const bestChar = charInfo.characters?.find(c => !c.isSeasonal) ?? charInfo.characters?.[0];
  if (!bestChar) { console.error('No characters'); process.exit(1); }

  const serverKey = acc.serverName?.trim();
  let host: string;
  if (serverKey && servers[serverKey]) {
    host = servers[serverKey];
  } else {
    const list = await svc.getServers({ accessToken });
    host = pickDefaultServer(list).host;
  }

  console.log(`Connecting ${acc.label} to ${host} charId=${bestChar.charId}`);

  const client = new Client({
    alias: acc.label || acc.email,
    host, port: 2050,
    buildVersion: gameVersion,
    accessToken, clientToken,
    gameId: -2,
    keyTime: -1, key: Buffer.alloc(0),
    charId: bestChar.charId,
    autoEnterVault: false,
    createChar: { isSeasonal: bestChar.isSeasonal, isChallenger: false, isBonus: false },
  });

  let mySlotCount = 0;

  client.on('tradeRequested', (name) => {
    console.log(`TRADEREQUESTED from ${name} — sending REQUESTTRADE back`);
    client.sendRequestTrade(name);
  });

  client.on('tradeStart', (pkt: TradeStartPacket) => {
    mySlotCount = pkt.clientItems.length;
    console.log(`TRADESTART partner=${pkt.partnerName} mySlots=${mySlotCount} theirSlots=${pkt.partnerItems.length}`);
    console.log(`  my items:    [${pkt.clientItems.map((it, i) => `${i}:${it.item}`).join(', ')}]`);
    console.log(`  their items: [${pkt.partnerItems.map((it, i) => `${i}:${it.item}`).join(', ')}]`);
  });

  client.on('tradeChanged', (offer: boolean[]) => {
    const offeredSlots = offer.map((v, i) => v ? i : null).filter(v => v !== null);
    console.log(`TRADECHANGED partnerOffer=[${offeredSlots.join(',')}] — sending ACCEPTTRADE`);
    const myOffer = new Array<boolean>(mySlotCount).fill(false);
    client.sendAcceptTrade(myOffer, offer);
  });

  client.on('tradeDone', (code, desc) => {
    console.log(`TRADEDONE code=${code} desc=${desc}`);
    client.disconnect();
  });

  await client.connect();
  console.log('Connected — waiting in nexus for a trade request...');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
