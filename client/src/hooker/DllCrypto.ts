/**
 * AES-256-GCM decryption for encrypted DLL assets.
 *
 * At build time, build-prod.mjs encrypts each DLL into a .bin file with the
 * format: [16-byte IV][16-byte authTag][ciphertext].
 *
 * The key is baked into the JS bundle via esbuild `define` (__DLL_KEY__) and
 * subsequently obfuscated by javascript-obfuscator.  In development mode the
 * constant is not defined, so callers should fall back to reading the raw DLL.
 */

import { createDecipheriv } from 'crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';

declare const __DLL_KEY__: string | undefined;

/**
 * Returns the hex AES key embedded at build time, or `null` in dev mode.
 */
export function getDllKey(): string | null {
  try {
    // __DLL_KEY__ is replaced by esbuild at bundle time.
    // In dev (tsx) it's undefined.
    return typeof __DLL_KEY__ !== 'undefined' ? __DLL_KEY__ : null;
  } catch {
    return null;
  }
}

/**
 * Decrypt an AES-256-GCM encrypted .bin file and return the plaintext Buffer.
 *
 * @param encPath  Path to the .bin file ([IV 16][authTag 16][ciphertext])
 * @param hexKey   64-char hex string (32 bytes)
 */
export function decryptDll(encPath: string, hexKey: string): Buffer {
  const packed = readFileSync(encPath);
  const iv = packed.subarray(0, 16);
  const authTag = packed.subarray(16, 32);
  const ciphertext = packed.subarray(32);

  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Resolve a DLL asset, decrypting on the fly in production.
 *
 * In production the .bin (encrypted) file is used; in dev the raw .dll is used.
 * Returns the path to the usable DLL on disk (may write a temp decrypted copy).
 *
 * @param assetsDir  The assets/ directory
 * @param baseName   e.g. "internal" → looks for internal.bin (prod) or internal.dll (dev)
 * @param outPath    Where to write the decrypted DLL (e.g. game dir or temp)
 */
export function extractEncryptedDll(
  assetsDir: string,
  baseName: string,
  outPath: string,
): boolean {
  const key = getDllKey();
  const binPath = `${assetsDir}/${baseName}.bin`;
  const dllPath = `${assetsDir}/${baseName}.dll`;

  if (key && existsSync(binPath)) {
    // Production: decrypt .bin → write to outPath
    const plain = decryptDll(binPath, key);
    writeFileSync(outPath, plain);
    return true;
  }

  if (existsSync(dllPath)) {
    // Dev: copy raw DLL
    copyFileSync(dllPath, outPath);
    return true;
  }

  return false;
}
