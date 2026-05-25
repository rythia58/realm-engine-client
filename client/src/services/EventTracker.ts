/**
 * Batched, anonymous event tracker.
 *
 * Other parts of the client call `track('event_name', { ...props })`. The
 * tracker buffers events in memory and flushes to bot-api every `flushMs` (or
 * immediately if the buffer fills). On flush failure the buffer is preserved
 * and retried on the next tick — bounded by `maxBuffer` so a long offline
 * stretch can't exhaust memory.
 *
 * Privacy: each event carries the device anon_id (shared with TelemetryEmitter,
 * so admins can correlate beat ↔ events) but no raw HWID, email, or character
 * name. Props are validated by the server-side `_truncate_props` helper.
 */
import { Logger } from '../util/Logger.js';
import type { BotApiClient, TelemetryEventPayload } from './BotApiClient.js';

export interface EventContext {
  /** Plan tier active when the event fired. Defaults to 'free'. */
  planTier?: string;
  /** Realm shard when the event fired. '' if not connected. */
  serverName?: string;
  /** Class name when the event fired. '' if not in-game. */
  className?: string;
  /** Client app version. */
  clientVersion?: string;
}

export interface EventTrackerOptions {
  botApi: BotApiClient;
  getAnonId: () => string | null;
  /** Pulled fresh on each enqueue so events carry the right context. */
  getContext: () => EventContext;
  /** When false, track() is a no-op (user opted out). */
  isEnabled?: () => boolean;
  /** Cadence for periodic flushes. Default 10s. */
  flushMs?: number;
  /** Flush early when the buffer hits this many events. Default 32. */
  flushAtBuffer?: number;
  /** Drop oldest events when the buffer exceeds this. Default 256. */
  maxBuffer?: number;
}

type BufferedEvent = TelemetryEventPayload & { _enqueuedAt: number };

export class EventTracker {
  private readonly botApi: BotApiClient;
  private readonly getAnonId: () => string | null;
  private readonly getContext: () => EventContext;
  private readonly isEnabled: () => boolean;
  private readonly flushMs: number;
  private readonly flushAtBuffer: number;
  private readonly maxBuffer: number;
  private buffer: BufferedEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(opts: EventTrackerOptions) {
    this.botApi = opts.botApi;
    this.getAnonId = opts.getAnonId;
    this.getContext = opts.getContext;
    this.isEnabled = opts.isEnabled ?? (() => true);
    this.flushMs = opts.flushMs ?? 10_000;
    this.flushAtBuffer = opts.flushAtBuffer ?? 32;
    this.maxBuffer = opts.maxBuffer ?? 256;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    Logger.log('Telemetry', `EventTracker started (${this.flushMs / 1000}s flush)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Best-effort final flush so we don't lose the last few events.
    void this.flush();
  }

  /**
   * Enqueue one event. Cheap; doesn't await network. Safe to call from any
   * hot path including per-packet handlers — but use restraint with high-volume
   * sources (e.g., don't track on every projectile).
   */
  track(eventName: string, props?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;
    const name = String(eventName || '').trim().toLowerCase();
    if (!name) return;
    const ctx = this.getContext();
    this.buffer.push({
      _enqueuedAt: Date.now(),
      event_name: name,
      event_props: props ? truncatePropsClient(props) : {},
      plan_tier: ctx.planTier || 'free',
      server_name: ctx.serverName || '',
      class_name: ctx.className || '',
      client_version: ctx.clientVersion || '',
      occurred_at: new Date().toISOString(),
    });
    if (this.buffer.length > this.maxBuffer) {
      // Drop oldest. If we ever see this trigger it's worth alerting on — a
      // healthy client should never out-pace a 10s flush.
      const overflow = this.buffer.length - this.maxBuffer;
      this.buffer.splice(0, overflow);
      Logger.warn('Telemetry', `EventTracker buffer overflow; dropped ${overflow} old events`);
    }
    if (this.buffer.length >= this.flushAtBuffer) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    if (!this.botApi.loggedIn) return;
    const anon = this.getAnonId();
    if (!anon) return;

    this.flushing = true;
    // Drain into a local array so concurrent track() calls during a slow POST
    // don't interfere. If the POST fails we re-prepend.
    const drained = this.buffer;
    this.buffer = [];
    try {
      const payload: TelemetryEventPayload[] = drained.map((e) => ({
        event_name: e.event_name,
        event_props: e.event_props,
        plan_tier: e.plan_tier,
        server_name: e.server_name,
        class_name: e.class_name,
        client_version: e.client_version,
        occurred_at: e.occurred_at,
      }));
      await this.botApi.sendTelemetryEvents(anon, payload);
    } catch (err) {
      // Put events back at the front. Capped by maxBuffer; if we're really
      // offline a long time, oldest events get dropped on the next track().
      const merged = drained.concat(this.buffer);
      this.buffer = merged.slice(-this.maxBuffer);
      Logger.warn('Telemetry', `Event flush failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }
}

function truncatePropsClient(props: Record<string, unknown>): Record<string, unknown> {
  // Same shape as the server's _truncate_props — trim early so we don't ship
  // megabyte payloads even if the server would reject them later.
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(props)) {
    if (typeof k !== 'string') continue;
    if (typeof v === 'string') {
      out[k] = v.length > 256 ? v.slice(0, 256) : v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else {
      const s = String(v);
      out[k] = s.length > 256 ? s.slice(0, 256) : s;
    }
    if (++count >= 16) break;
  }
  return out;
}
