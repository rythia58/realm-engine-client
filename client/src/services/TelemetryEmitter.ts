/**
 * Anonymous telemetry heartbeat — posts client state to bot-api every 60s while
 * the user is logged in. Powers the admin telemetry dashboard.
 *
 * Privacy: we never send the raw HWID, the user's email, the player's IGN, or
 * any character names. The `anon_id` is sha256(HWID) — stable per device, but
 * one-way. Settings fingerprints are also hashed, never raw.
 */
import { createHash } from 'crypto';
import { Logger } from '../util/Logger.js';
import { getClientToken } from '../util/Hwid.js';
import type { BotApiClient } from './BotApiClient.js';

export interface TelemetrySnapshot {
  /** Current realm shard ("USWest"), or '' if not connected to a game. */
  serverName: string;
  /** RotMG ObjectType for the player's class. 0 if not in-game. */
  classId: number;
  /** Human-readable class name resolved via GameData ("Wizard"). '' if unknown. */
  className: string;
  /** Plan tier the local user has active right now: "free" | "premium" | ... */
  planTier: string;
  /** IDs of all plugins currently enabled. */
  pluginsEnabled: string[];
  /** Stable fingerprint over the canonical settings JSON. '' if no settings. */
  settingsFingerprint: string;
  /** Per-setting key/value summary for popularity breakdowns. */
  settingsSummary: Record<string, string>;
  /** Wall-clock time the dashboard session started (ISO 8601), or null. */
  sessionStartedAt: Date | null;
}

export interface TelemetryEmitterOptions {
  botApi: BotApiClient;
  /** Pulled fresh on each tick so the emitter always sees current state. */
  getSnapshot: () => TelemetrySnapshot | null;
  /** When this returns false, ticks are no-ops (user opted out). */
  isEnabled?: () => boolean;
  /** Override for tests; defaults to package.json version baked in by build. */
  clientVersion?: string;
  /** Override for tests; defaults to process.platform. */
  osPlatform?: string;
  /** Cadence in ms. Server expects ~60s. */
  intervalMs?: number;
}

/**
 * Hashes the device HWID into the wire-level pseudonym. We deliberately don't
 * pepper this — the pepper would be public anyway (baked into the client
 * binary), so it adds zero security. If we ever want one-way mapping that's
 * also resistant to rainbow tables, the server should pepper-rehash before
 * insert and we should re-emit. For v1, raw sha256 is adequate.
 */
export function computeAnonId(hwid: string): string {
  return createHash('sha256').update(hwid, 'utf8').digest('hex');
}

/** Stable hash over an object's key-sorted JSON. Use to fingerprint settings. */
export function fingerprintObject(obj: unknown): string {
  if (obj == null) return '';
  const canonical = JSON.stringify(obj, sortKeys);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export class TelemetryEmitter {
  private readonly botApi: BotApiClient;
  private readonly getSnapshot: () => TelemetrySnapshot | null;
  private readonly isEnabled: () => boolean;
  private readonly clientVersion: string;
  private readonly osPlatform: string;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private anonId: string | null = null;
  /** Backoff after a failed POST so we don't hammer a degraded server. */
  private consecutiveFailures = 0;

  constructor(opts: TelemetryEmitterOptions) {
    this.botApi = opts.botApi;
    this.getSnapshot = opts.getSnapshot;
    this.isEnabled = opts.isEnabled ?? (() => true);
    this.clientVersion = opts.clientVersion || '0.0.0';
    this.osPlatform = opts.osPlatform || process.platform;
    this.intervalMs = opts.intervalMs ?? 60_000;
  }

  /** Expose the device pseudonym so the event tracker can share it. */
  getAnonId(): string | null {
    if (this.anonId) return this.anonId;
    try {
      const hwid = getClientToken();
      if (!hwid) return null;
      this.anonId = computeAnonId(hwid);
      return this.anonId;
    } catch {
      return null;
    }
  }

  start(): void {
    if (this.timer) return;
    // Lazily compute the anon_id so we don't touch the HWID file on construction.
    if (!this.anonId) {
      try {
        const hwid = getClientToken();
        if (!hwid) {
          Logger.warn('Telemetry', 'No HWID available; emitter idle');
          return;
        }
        this.anonId = computeAnonId(hwid);
      } catch (err) {
        Logger.warn('Telemetry', `HWID hash failed: ${(err as Error).message}; emitter idle`);
        return;
      }
    }
    // Fire one immediately so the admin dashboard isn't blank for the first minute,
    // then settle into the recurring cadence.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    Logger.log('Telemetry', `Emitter started (${this.intervalMs / 1000}s cadence)`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    Logger.log('Telemetry', 'Emitter stopped');
  }

  private async tick(): Promise<void> {
    // Don't ping the server while the user is signed out — heartbeat is auth-gated.
    if (!this.botApi.loggedIn) return;
    // Opt-out: still want timer running so we can resume without restart.
    if (!this.isEnabled()) return;
    const snap = this.getSnapshot();
    if (!snap || !this.anonId) return;

    try {
      await this.botApi.sendTelemetryHeartbeat({
        anon_id: this.anonId,
        plan_tier: snap.planTier || 'free',
        server_name: snap.serverName || '',
        class_id: snap.classId | 0,
        class_name: snap.className || '',
        plugins_enabled: snap.pluginsEnabled.slice(0, 128),
        settings_fingerprint: snap.settingsFingerprint || '',
        settings_summary: snap.settingsSummary || {},
        client_version: this.clientVersion,
        os_platform: this.osPlatform,
        session_started_at: snap.sessionStartedAt ? snap.sessionStartedAt.toISOString() : null,
      });
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      // Quiet after the first failure so we don't spam logs while offline.
      if (this.consecutiveFailures <= 1 || this.consecutiveFailures % 10 === 0) {
        Logger.warn('Telemetry', `Heartbeat failed (#${this.consecutiveFailures}): ${(err as Error).message}`);
      }
    }
  }
}
