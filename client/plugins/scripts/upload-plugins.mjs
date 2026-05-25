/**
 * Upload obfuscated plugins to S3 under the core-plugins/ prefix.
 *
 * Run after build:prod (which compiles + obfuscates plugins into dist/plugins/):
 *
 *   node scripts/upload-plugins.mjs
 *
 * Requires AWS credentials (env vars or ~/.aws/credentials) and:
 *   S3_BUCKET_NAME  — target bucket
 *   S3_REGION       — bucket region (default: us-east-1)
 *
 * This replaces ALL core plugins in S3 — old ones are deleted first.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createCipheriv, createHash, randomBytes, sign, createPrivateKey } from 'crypto';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGINS_DIR = join(ROOT, 'dist', 'plugins');
const PREFIX = 'core-plugins/';
const BUNDLE_KEY = `${PREFIX}bundle.v1.json`;

const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.S3_REGION || 'us-east-1';
const ENC_KEY_HEX = String(process.env.PLUGIN_BUNDLE_ENC_KEY || '').trim();
const SIGNING_KEY_PEM = process.env.PLUGIN_BUNDLE_SIGNING_PRIVATE_KEY_PEM || '';

if (!BUCKET) {
  console.error('ERROR: S3_BUCKET_NAME env var is required');
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(ENC_KEY_HEX)) {
  console.error('ERROR: PLUGIN_BUNDLE_ENC_KEY must be a 64-char hex key (32 bytes)');
  process.exit(1);
}

if (!SIGNING_KEY_PEM.trim()) {
  console.error('ERROR: PLUGIN_BUNDLE_SIGNING_PRIVATE_KEY_PEM is required (PEM text)');
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });
const encKey = Buffer.from(ENC_KEY_HEX, 'hex');
const signingKey = createPrivateKey(SIGNING_KEY_PEM);

function log(msg) {
  console.log(`[upload-plugins] ${msg}`);
}

// 1. List and delete existing core plugins
log('Cleaning existing core plugins from S3...');
const listResp = await s3.send(new ListObjectsV2Command({
  Bucket: BUCKET,
  Prefix: PREFIX,
}));

if (listResp.Contents && listResp.Contents.length > 0) {
  await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: {
      Objects: listResp.Contents.map(obj => ({ Key: obj.Key })),
    },
  }));
  log(`Deleted ${listResp.Contents.length} existing plugin(s)`);
}

// 2. Upload new plugins
const files = readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
log(`Preparing secure bundle for ${files.length} plugins...`);

const generatedAt = new Date().toISOString();
const plugins = [];

for (const file of files) {
  const code = readFileSync(join(PLUGINS_DIR, file), 'utf-8');
  const pluginId = file.replace(/\.js$/i, '');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const sha256 = createHash('sha256').update(code).digest('hex');
  plugins.push({
    id: pluginId,
    alg: 'aes-256-gcm',
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
    ciphertextB64: ciphertext.toString('base64'),
    sha256,
  });
  log(`  staged ${file} (${(code.length / 1024).toFixed(1)} KB)`);
}

plugins.sort((a, b) => a.id.localeCompare(b.id));
const payloadObject = {
  version: 1,
  protocol: 'plugin-bundle-v1',
  generatedAt,
  plugins,
};
const payloadJson = JSON.stringify(payloadObject);
const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64');
const signatureB64 = sign(null, Buffer.from(payloadB64, 'utf8'), signingKey).toString('base64');

const bundle = {
  version: 1,
  sigAlg: 'ed25519',
  payloadB64,
  signatureB64,
};

await s3.send(new PutObjectCommand({
  Bucket: BUCKET,
  Key: BUNDLE_KEY,
  Body: JSON.stringify(bundle),
  ContentType: 'application/json',
}));

log(`Done! Secure plugin bundle uploaded to s3://${BUCKET}/${BUNDLE_KEY}`);
