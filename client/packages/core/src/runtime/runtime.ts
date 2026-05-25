import { EventEmitter } from 'node:events';
import { Environment } from './environment.js';
import { Logger, LogLevel } from '../services/logger.js';
import { AccountService, pickDefaultServer } from '../services/account-service.js';
import type { Account } from '../models/index.js';
import { Client } from '../core/client.js';
import { LibraryManager } from '../core/library-manager.js';

export class Runtime extends EventEmitter {
  constructor(readonly env: Environment) {
    super();
  }

  async run(args: Record<string, unknown>): Promise<void> {
    const debug = Boolean(args.debug);
    Logger.setMinLevel(debug ? LogLevel.Debug : LogLevel.Info);
    Logger.log('Runtime', `Starting in ${this.env.root}`, LogLevel.Info);

    const accounts = (this.env.readJSON<Account[]>('accounts.json') ?? this.env.readJSON<Account[]>('Accounts.json') ?? []) as Account[];
    Logger.log('Runtime', `Loaded ${Array.isArray(accounts) ? accounts.length : 0} accounts`, LogLevel.Info);

    const buildVersion = (this.env.readText('gameVersion.txt') ?? '').trim();
    if (!buildVersion) {
      Logger.log('Runtime', 'Missing gameVersion.txt in root; HELLO buildVersion will be empty.', LogLevel.Warning);
    }

    const svc = new AccountService();
    const libs = new LibraryManager(this.env.root);
    await libs.loadPlugins('plugins');

    if (!Array.isArray(accounts) || accounts.length === 0) return;

    for (const acc of accounts) {
      const alias = acc.alias ?? acc.guid;
      const passwordOrSecret = acc.password ?? acc.secret ?? '';
      const clientToken = AccountService.makeClientToken(acc.guid, passwordOrSecret);

      Logger.log(alias, 'Verifying account...', LogLevel.Info);
      const { accessToken } = await svc.verify({
        guid: acc.guid,
        password: acc.password,
        secret: acc.secret,
        clientToken
      });
      await svc.verifyToken({ accessToken, clientToken });

      const charInfo = await svc.charList({ accessToken });
      const charId = charInfo.currentCharId;
      const needsNewChar = Boolean(charInfo.needsNewChar);
      const gameId = charInfo.inTutorial ? -1 : -2;

      let host = acc.serverHost;
      const pref = (acc.serverPref as string | undefined)?.trim() || undefined;
      let serverLabel: string | undefined = pref;
      if (!host) {
        const servers = await svc.getServers({ accessToken });
        const { key, host: h } = pickDefaultServer(servers);
        host = h;
        serverLabel = serverLabel ?? key;
        Logger.log(alias, `Picked server ${key} @ ${host} from server list`, LogLevel.Info);
      } else {
        serverLabel = serverLabel ?? host;
      }
      const port = acc.serverPort ?? 2050;

      const client = new Client({
        alias,
        host,
        port,
        serverLabel,
        buildVersion,
        accessToken,
        clientToken,
        gameId,
        keyTime: -1,
        key: Buffer.alloc(0),
        charId,
        needsNewChar,
        libraryManager: libs
      });

      await client.connect();
    }
  }
}

