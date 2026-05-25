import { randomBytes, createHash } from 'node:crypto';
import { DECA_ENDPOINTS } from './deca-api.js';
import { httpText } from './http.js';

export type VerifyResult = {
  accessToken: string;
};

export type CharacterDetail = {
  charId: number;
  classType: number;
  level: number;
  isSeasonal: boolean;
};

export type CharacterInfo = {
  raw: string;
  nextCharId?: number;
  maxNumChars?: number;
  charIds?: number[];
  currentCharId?: number;
  needsNewChar?: boolean;
  inTutorial?: boolean;
  /** Parsed per-character details. Includes seasonal flag from the <Seasonal> XML element. */
  characters?: CharacterDetail[];
};

export type ServerList = Record<string, string>;

const DEFAULT_DECA_SERVER_KEY = 'Asia';

/**
 * Choose host when `serverHost` is not in `Accounts.json`. Prefers the **Asia** key from the
 * Deca server list (case-insensitive), otherwise the first key in stable sort order.
 */
export function pickDefaultServer(servers: ServerList): { key: string; host: string } {
  const keys = Object.keys(servers).sort();
  if (keys.length === 0) {
    throw new Error('pickDefaultServer: server list is empty');
  }
  const preferred = keys.find((k) => k.toLowerCase() === DEFAULT_DECA_SERVER_KEY.toLowerCase());
  const key = preferred ?? keys[0]!;
  const host = servers[key];
  if (host === undefined) {
    throw new Error(`pickDefaultServer: missing host for key ${key}`);
  }
  return { key, host };
}

export class AccountService {
  async verify(opts: { guid: string; password?: string; secret?: string; clientToken: string }): Promise<VerifyResult> {
    const pwdKey = opts.password ? 'password' : 'secret';
    const pwdVal = opts.password ?? opts.secret ?? '';
    const text = await httpText(DECA_ENDPOINTS.VERIFY, {
      method: 'POST',
      form: {
        guid: opts.guid,
        [pwdKey]: pwdVal,
        clientToken: opts.clientToken,
        game_net: 'Unity',
        play_platform: 'Unity',
        game_net_user_id: ''
      }
    });
    const m = /<AccessToken>(.+)<\/AccessToken>/.exec(text);
    if (!m) throw new Error(`verify failed: ${text}`);
    return { accessToken: m[1] };
  }

  async verifyToken(opts: { accessToken: string; clientToken: string }): Promise<void> {
    const text = await httpText(DECA_ENDPOINTS.VERIFY_TOKEN, {
      method: 'POST',
      form: {
        clientToken: opts.clientToken,
        accessToken: opts.accessToken,
        game_net: 'Unity',
        play_platform: 'Unity',
        game_net_user_id: ''
      }
    });
    if (!text.includes('Success')) throw new Error(`verifyToken failed: ${text}`);
  }

  async charList(opts: { accessToken: string }): Promise<CharacterInfo> {
    const text = await httpText(DECA_ENDPOINTS.CHAR_LIST, {
      method: 'POST',
      form: {
        do_login: 'true',
        accessToken: opts.accessToken,
        game_net: 'Unity',
        play_platform: 'Unity',
        game_net_user_id: ''
      }
    });

    const info: CharacterInfo = { raw: text };
    const header = /<Chars nextCharId="(\d+)" maxNumChars="(\d+)">/.exec(text);
    if (header) {
      info.nextCharId = Number(header[1]);
      info.maxNumChars = Number(header[2]);
    }
    // Parse each <Char id="N">...</Char> block for detailed info
    const charBlocks = [...text.matchAll(/<Char id="(\d+)">([\s\S]*?)<\/Char>/g)];
    if (charBlocks.length) {
      const characters: CharacterDetail[] = charBlocks.map((m) => {
        const charId = Number(m[1]);
        const block = m[2] ?? '';
        const classType = Number(/<ObjectType>(\d+)<\/ObjectType>/.exec(block)?.[1] ?? 0);
        const level = Number(/<Level>(\d+)<\/Level>/.exec(block)?.[1] ?? 0);
        // <Seasonal>true</Seasonal>, <Seasonal>1</Seasonal>, or <Seasonal/> = seasonal
        const seasonalTag = /<Seasonal[^>]*>([^<]*)<\/Seasonal>|<Seasonal\s*\/>/.exec(block);
        let isSeasonal = false;
        if (seasonalTag) {
          const val = (seasonalTag[1] ?? '').trim().toLowerCase();
          isSeasonal = !val || val === 'true' || val === '1';
        }
        return { charId, classType, level, isSeasonal };
      });
      info.characters = characters;
      info.charIds = characters.map((c) => c.charId);
      info.currentCharId = characters[0]?.charId;
    } else if (info.nextCharId !== undefined) {
      info.charIds = [info.nextCharId];
      info.currentCharId = info.nextCharId;
      info.nextCharId = info.nextCharId + 1;
      info.needsNewChar = true;
    }
    info.inTutorial = !text.includes('TDone');
    return info;
  }

  async getServers(opts: { accessToken: string }): Promise<ServerList> {
    const text = await httpText(DECA_ENDPOINTS.SERVERS, {
      method: 'POST',
      form: {
        accessToken: opts.accessToken,
        game_net: 'Unity',
        play_platform: 'Unity',
        game_net_user_id: ''
      }
    });
    const servers: ServerList = {};
    for (const m of text.matchAll(/<Server>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<DNS>(.*?)<\/DNS>[\s\S]*?<\/Server>/g)) {
      const name = m[1]?.trim();
      const dns = m[2]?.trim();
      if (name && dns) servers[name] = dns;
    }
    if (Object.keys(servers).length === 0) {
      throw new Error(`getServers: failed to parse servers: ${text.slice(0, 500)}`);
    }
    return servers;
  }

  static makeClientToken(guid: string, passwordOrSecret: string): string {
    return createHash('md5').update(Buffer.from(guid, 'utf8')).update(Buffer.from(passwordOrSecret, 'utf8')).digest('hex');
  }

  static randomUnityClientToken(): string {
    return randomBytes(16).toString('hex');
  }
}

