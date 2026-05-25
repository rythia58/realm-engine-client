import { DEFAULT_UNITY_HEADERS, type UnityHeaders } from './deca-api.js';

export type HttpOptions = {
  headers?: Partial<UnityHeaders> & Record<string, string>;
  form?: Record<string, string>;
  method?: 'GET' | 'POST';
};

export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const method = opts.method ?? (opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    ...DEFAULT_UNITY_HEADERS,
    ...(opts.headers ?? {})
  };

  let body: string | undefined;
  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text.slice(0, 500)}`);
  }
  return text;
}

