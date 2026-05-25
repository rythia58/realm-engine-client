/**
 * Classes not re-exported from the SDK package root, or loaded via CJS so
 * patches apply to the same module identity as the published bundle.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VaultChest: any = require('@realmengine/sdk/dist/vault/VaultChest.js').VaultChest;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GiftChest: any = require('@realmengine/sdk/dist/vault/GiftChest.js').GiftChest;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Self: any = require('@realmengine/sdk/dist/self/Self.js').Self;
