export const DECA_ENDPOINTS = {
  VERIFY: 'https://www.realmofthemadgod.com/account/verify',
  VERIFY_TOKEN: 'https://www.realmofthemadgod.com/account/verifyAccessTokenClient',
  CHAR_LIST: 'https://www.realmofthemadgod.com/char/list',
  SERVERS: 'https://www.realmofthemadgod.com/account/servers',
  VERSION: 'https://static.drips.pw/rotmg/production/current/version.txt'
} as const;

export type UnityHeaders = {
  'User-Agent': string;
  'X-Unity-Version': string;
};

export const DEFAULT_UNITY_HEADERS: UnityHeaders = {
  'User-Agent': 'UnityPlayer/2021.3.16f1 (UnityWebRequest/1.0, libcurl/7.84.0-DEV)',
  'X-Unity-Version': '2021.3.16f1'
};

