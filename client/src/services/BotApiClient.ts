import { Logger } from '../util/Logger.js';

export interface ActiveSubscription {
  plan_name: string;
  status?: string;
  expires_at?: string | null;
}

export interface GemStatusResponse {
  gem_balance: number;
  active: boolean;
  next_deduction_at: string | null;
  /** Active subscription records from the server. Used for per-plan plugin gating. */
  active_subs?: ActiveSubscription[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface ScriptUsageResponse {
  gems_charged: number;
  new_balance?: number;
  allowed: boolean;
}

export interface GemBundle {
  id: string;
  gems: number;
  price_usd: number;
  label: string;
  bonus_pct: number;
}

export interface StripeCheckoutResponse {
  payment_id: string;
  checkout_url: string;
}

export interface ScriptDownloadResponse {
  url: string;
  sha256: string;
}

export interface ScriptRuntimeResponse {
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface TelemetryHeartbeatPayload {
  anon_id: string;
  plan_tier: string;
  server_name: string;
  class_id: number;
  class_name: string;
  plugins_enabled: string[];
  settings_fingerprint: string;
  settings_summary: Record<string, string>;
  client_version: string;
  os_platform: string;
  session_started_at: string | null;
}

export interface TelemetryEventPayload {
  event_name: string;
  event_props?: Record<string, unknown>;
  plan_tier?: string;
  server_name?: string;
  class_name?: string;
  client_version?: string;
  occurred_at?: string;
}

export interface TelemetryEventBatchAck {
  accepted: number;
  rejected: number;
}

export interface TelemetrySettingsRow {
  key: string;
  value: string;
  count: number;
}

export interface TelemetrySettingsBreakdown {
  window_minutes: number;
  sampled_at: string;
  total: number;
  rows: TelemetrySettingsRow[];
}

export interface TelemetryTimelinePoint {
  bucket_start: string;
  active_users: number;
}

export interface TelemetryTimeline {
  window_minutes: number;
  bucket_seconds: number;
  sampled_at: string;
  points: TelemetryTimelinePoint[];
}

export interface TelemetryEventTimelinePoint {
  bucket_start: string;
  count: number;
}

export interface TelemetryEventTimeline {
  event_name: string;
  window_minutes: number;
  bucket_seconds: number;
  sampled_at: string;
  points: TelemetryEventTimelinePoint[];
}

export interface TelemetryHeartbeatAck {
  ok: boolean;
  received_at: string;
  next_heartbeat_seconds: number;
}

export interface TelemetryOverviewResponse {
  active_5m: number;
  active_1h: number;
  active_24h: number;
  plan_distribution: Record<string, number>;
  free_users: number;
  paid_users: number;
  sampled_at: string;
}

export interface TelemetryBreakdownRow {
  key: string;
  label: string;
  count: number;
}

export interface TelemetryBreakdownResponse {
  window_minutes: number;
  sampled_at: string;
  total: number;
  rows: TelemetryBreakdownRow[];
}

// Sent on every request so bot-api can enforce min_client_version. Server
// returns 426 Upgrade Required when this version is below the operator-set
// floor (see dependencies.require_supported_client_version).
const CLIENT_VERSION_HEADER = 'X-RE-Client-Version';

/** Thrown when bot-api rejects a request because this client is below the
 *  operator-set min_client_version. Consumers should treat this as terminal —
 *  no further API calls will succeed until the user updates. */
export class ClientOutdatedError extends Error {
  readonly name = 'ClientOutdatedError';
  constructor(
    readonly minVersion: string,
    readonly currentVersion: string,
    message: string,
  ) {
    super(message);
  }
}

async function detectOutdated(res: Response, currentVersion: string): Promise<ClientOutdatedError | null> {
  if (res.status !== 426) return null;
  let detail: { min_version?: string; current_version?: string; message?: string } = {};
  try {
    const body = await res.json();
    if (body && typeof body.detail === 'object') detail = body.detail;
    else if (body && typeof body.detail === 'string') detail = { message: body.detail };
  } catch { /* fall through */ }
  return new ClientOutdatedError(
    detail.min_version || '',
    detail.current_version || currentVersion,
    detail.message || 'Your Realm Engine client is out of date and must be updated.',
  );
}

export class BotApiClient {
  private baseUrl: string;
  private clientVersion: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseUrl: string, clientVersion: string = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientVersion = clientVersion;
  }

  /** Build base headers with the optional version header attached. */
  private baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (this.clientVersion) h[CLIENT_VERSION_HEADER] = this.clientVersion;
    return h;
  }

  get loggedIn(): boolean {
    return this.accessToken !== null;
  }

  async login(email: string, password: string): Promise<GemStatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify({ email, password }),
    });

    const outdated = await detectOutdated(res, this.clientVersion);
    if (outdated) throw outdated;

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `Login failed (${res.status})`);
    }

    const tokens: AuthTokens = await res.json();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    Logger.log('BotApiClient', 'Logged in successfully');

    return this.checkGems();
  }

  /**
   * Pre-seed tokens from the dashboard session (dashboard already logged in).
   * This avoids the plugin tab requiring a separate login form.
   */
  loginWithTokens(accessToken: string, refreshToken: string | null): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    Logger.log('BotApiClient', 'Session seeded from dashboard tokens');
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    Logger.log('BotApiClient', 'Logged out');
  }

  async checkGems(): Promise<GemStatusResponse> {
    const data = await this.authedGet<GemStatusResponse>('/api/payments/gems/status');
    return data;
  }

  async checkAndDeductGems(): Promise<GemStatusResponse> {
    const res = await this.authedPost<GemStatusResponse>('/api/payments/gems/check-deduction');
    return res;
  }

  /**
   * Log per-use script billing. Call before each script execution.
   * Returns whether the user is allowed to run the script.
   */
  async logScriptUsage(scriptId: string): Promise<ScriptUsageResponse> {
    return this.authedPost<ScriptUsageResponse>(`/api/marketplace/scripts/${scriptId}/use`);
  }

  /**
   * Get a presigned S3 download URL + SHA-256 hash for a script file.
   * The client should verify the hash after downloading.
   */
  async getScriptDownload(scriptId: string): Promise<ScriptDownloadResponse> {
    return this.authedGet<ScriptDownloadResponse>(`/api/marketplace/scripts/${scriptId}/download`);
  }

  /**
   * Fetch an HWID-encrypted script payload for in-memory loading.
   * The server verifies access, fetches the .mjs from S3, and returns
   * AES-256-GCM ciphertext bound to this user+HWID. Never a raw source URL.
   */
  async getScriptRuntime(scriptId: string, hwid: string): Promise<ScriptRuntimeResponse> {
    return this.authedPost<ScriptRuntimeResponse>(
      `/api/marketplace/scripts/${scriptId}/runtime`,
      { hwid },
    );
  }

  /** List the scripts owned by the current user (active access only). */
  async getOwnedScripts(): Promise<Array<{ id: string; script_id: string; script_name: string; expires_at: string | null; gems_paid: number }>> {
    return this.authedGet(`/api/marketplace/scripts/owned`);
  }

  /** Get the user's gem balance. */
  async getGemBalance(): Promise<number> {
    const data = await this.authedGet<{ gem_balance: number }>('/api/payments/gems/balance');
    return data.gem_balance;
  }

  /** Get available gem bundles. */
  async getBundles(): Promise<GemBundle[]> {
    return this.authedGet<GemBundle[]>('/api/payments/bundles');
  }

  /** Create a Stripe checkout session for a bundle. Returns the checkout URL. */
  async createStripeCheckout(bundleId: string): Promise<StripeCheckoutResponse> {
    return this.authedPost<StripeCheckoutResponse>('/api/payments/stripe/create-checkout', { bundle_id: bundleId });
  }

  // ── Telemetry ──────────────────────────────────────────────────────────────

  async sendTelemetryHeartbeat(payload: TelemetryHeartbeatPayload): Promise<TelemetryHeartbeatAck> {
    return this.authedPost<TelemetryHeartbeatAck>('/api/telemetry/heartbeat', payload);
  }

  async sendTelemetryEvents(anonId: string, events: TelemetryEventPayload[]): Promise<TelemetryEventBatchAck> {
    return this.authedPost<TelemetryEventBatchAck>('/api/telemetry/event', {
      anon_id: anonId,
      events,
    });
  }

  async getTelemetryOverview(): Promise<TelemetryOverviewResponse> {
    return this.authedGet<TelemetryOverviewResponse>('/api/admin/telemetry/overview');
  }

  async getTelemetryServers(windowMinutes = 5): Promise<TelemetryBreakdownResponse> {
    return this.authedGet<TelemetryBreakdownResponse>(`/api/admin/telemetry/servers?window=${windowMinutes}`);
  }

  async getTelemetryClasses(windowMinutes = 5): Promise<TelemetryBreakdownResponse> {
    return this.authedGet<TelemetryBreakdownResponse>(`/api/admin/telemetry/classes?window=${windowMinutes}`);
  }

  async getTelemetryPlugins(windowMinutes = 5): Promise<TelemetryBreakdownResponse> {
    return this.authedGet<TelemetryBreakdownResponse>(`/api/admin/telemetry/plugins?window=${windowMinutes}`);
  }

  async getTelemetrySettings(windowMinutes = 60): Promise<TelemetrySettingsBreakdown> {
    return this.authedGet<TelemetrySettingsBreakdown>(`/api/admin/telemetry/settings?window=${windowMinutes}`);
  }

  async getTelemetryTimeline(windowMinutes = 24 * 60, bucketSeconds = 300): Promise<TelemetryTimeline> {
    return this.authedGet<TelemetryTimeline>(`/api/admin/telemetry/timeline?window=${windowMinutes}&bucket=${bucketSeconds}`);
  }

  async getTelemetryTopEvents(windowMinutes = 24 * 60, limit = 32): Promise<TelemetryBreakdownResponse> {
    return this.authedGet<TelemetryBreakdownResponse>(`/api/admin/telemetry/events/top?window=${windowMinutes}&limit=${limit}`);
  }

  async getTelemetryEventTimeline(name: string, windowMinutes = 24 * 60, bucketSeconds = 300): Promise<TelemetryEventTimeline> {
    const q = `name=${encodeURIComponent(name)}&window=${windowMinutes}&bucket=${bucketSeconds}`;
    return this.authedGet<TelemetryEventTimeline>(`/api/admin/telemetry/events/timeline?${q}`);
  }

  private async authedGet<T>(path: string): Promise<T> {
    return this.authedRequest<T>(path, 'GET');
  }

  private async authedPost<T>(path: string, body?: unknown): Promise<T> {
    return this.authedRequest<T>(path, 'POST', body);
  }

  private async authedRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
    if (!this.accessToken) throw new Error('Not logged in');

    let res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.baseHeaders({ Authorization: `Bearer ${this.accessToken}` }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Try token refresh on 401
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.baseHeaders({ Authorization: `Bearer ${this.accessToken}` }),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      }
    }

    const outdated = await detectOutdated(res, this.clientVersion);
    if (outdated) throw outdated;

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `Request failed (${res.status})`);
    }

    return res.json() as Promise<T>;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: this.baseHeaders(),
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      const outdated = await detectOutdated(res, this.clientVersion);
      if (outdated) throw outdated;

      if (!res.ok) {
        this.logout();
        return false;
      }

      const tokens: AuthTokens = await res.json();
      this.accessToken = tokens.access_token;
      this.refreshToken = tokens.refresh_token;
      Logger.log('BotApiClient', 'Token refreshed');
      return true;
    } catch (err) {
      // 426 is terminal — surface to the caller of authedRequest rather than
      // silently logging out so the dashboard can prompt for an update.
      if (err instanceof ClientOutdatedError) throw err;
      this.logout();
      return false;
    }
  }
}
