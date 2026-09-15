/**
 * Network layer: optional user relay → public CORS proxies → direct (rare).
 * Never stores media. Failures return structured errors for the UI.
 */

const DEFAULT_RELAY_PATH = '/fetch';

/** Public CORS helpers — flaky by nature; order is preference. */
export const PUBLIC_PROXIES = [
  {
    id: 'allorigins',
    label: 'AllOrigins',
    wrap: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'codetabs',
    label: 'CodeTabs',
    wrap: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  },
  {
    id: 'corsproxy',
    label: 'corsproxy.io',
    wrap: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  },
];

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
};

function getRelayBase() {
  try {
    return localStorage.getItem('sg.relay') || '';
  } catch {
    return '';
  }
}

function getProxyPref() {
  try {
    return localStorage.getItem('sg.useProxies') !== '0';
  } catch {
    return true;
  }
}

function getRelayPref() {
  try {
    return localStorage.getItem('sg.useRelay') !== '0';
  } catch {
    return true;
  }
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(res) {
  const text = await res.text();
  return { text, status: res.status, ok: res.ok };
}

/**
 * Fetch a remote URL through the configured chain.
 * @param {string} target absolute http(s) URL to read
 * @param {{path?: string, headers?: Record<string,string>, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, status: number, text: string, via: string, error?: string}>}
 */
export async function proxiedFetch(target, opts = {}) {
  const timeoutMs = opts.timeoutMs || 12000;
  const attempts = [];

  const relay = getRelayBase();
  if (relay && getRelayPref()) {
    const base = relay.replace(/\/$/, '');
    const path = opts.path || DEFAULT_RELAY_PATH;
    attempts.push({
      via: 'relay',
      label: 'Your relay',
      url: `${base}${path}?url=${encodeURIComponent(target)}`,
    });
  }

  if (getProxyPref()) {
    for (const p of PUBLIC_PROXIES) {
      attempts.push({
        via: p.id,
        label: p.label,
        url: p.wrap(target),
      });
    }
  }

  // last resort: direct (will usually fail CORS, but cheap to try)
  attempts.push({
    via: 'direct',
    label: 'Direct',
    url: target,
  });

  const errors = [];

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(
        attempt.url,
        { headers: opts.headers || {} },
        timeoutMs
      );
      const body = await readBody(res);

      if (body.ok && body.text && body.text.length > 2) {
        return {
          ok: true,
          status: body.status,
          text: body.text,
          via: attempt.via,
        };
      }

      // some proxies return 200 with empty/error pages
      errors.push(`${attempt.label}: HTTP ${body.status}`);
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'failed';
      errors.push(`${attempt.label}: ${msg}`);
    }
  }

  return {
    ok: false,
    status: 0,
    text: '',
    via: '',
    error: errors.join(' · ') || 'All fetch routes failed',
  };
}

export function listRoutesSummary() {
  const relay = getRelayBase();
  const rows = [];
  if (relay && getRelayPref()) rows.push({ id: 'relay', label: 'Your relay', configured: true, url: relay });
  if (getProxyPref()) {
    for (const p of PUBLIC_PROXIES) rows.push({ id: p.id, label: p.label, configured: false, url: p.wrap('…') });
  }
  rows.push({ id: 'direct', label: 'Direct (browser)', configured: false, url: 'same-origin only' });
  return rows;
}

export function saveSettings({ relay, useRelay, useProxies }) {
  try {
    if (relay !== undefined) localStorage.setItem('sg.relay', String(relay).trim());
    if (useRelay !== undefined) localStorage.setItem('sg.useRelay', useRelay ? '1' : '0');
    if (useProxies !== undefined) localStorage.setItem('sg.useProxies', useProxies ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export function loadSettings() {
  return {
    relay: getRelayBase(),
    useRelay: getRelayPref(),
    useProxies: getProxyPref(),
  };
}

/**
 * Ask the configured relay (or same-origin /api/resolve on Vercel) to resolve.
 * @returns {Promise<{ok: boolean, items?: any[], error?: string, hint?: string, source?: string, via: string}>}
 */
export async function resolveViaRelay(targetUrl) {
  const relay = getRelayBase();
  const endpoints = [];

  // Same-origin first when deployed (Vercel api/resolve.js)
  if (typeof location !== 'undefined' && location.origin && location.protocol.startsWith('http')) {
    endpoints.push({
      id: 'origin',
      url: `${location.origin}/api/resolve?url=${encodeURIComponent(targetUrl)}`,
    });
  }

  if (relay && getRelayPref()) {
    const base = relay.replace(/\/$/, '');
    endpoints.push({
      id: 'relay',
      url: `${base}/api/resolve?url=${encodeURIComponent(targetUrl)}`,
    });
  }

  if (!endpoints.length) {
    return { ok: false, via: 'none', error: 'No relay configured' };
  }

  let lastError = 'No relay configured';
  let lastHint = '';

  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint.url, { headers: { Accept: 'application/json' } }, 20000);
      // same-origin 404 means this host has no API — try next
      if (res.status === 404) {
        lastError = 'Relay not found';
        continue;
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        lastError = `Relay returned non-JSON (HTTP ${res.status})`;
        lastHint = 'Check Worker/Vercel function deploy.';
        continue;
      }
      if (json && json.ok && Array.isArray(json.items) && json.items.length) {
        return {
          ok: true,
          via: endpoint.id,
          items: json.items,
          source: json.source || endpoint.id,
        };
      }
      lastError = (json && json.error) || `Relay could not resolve (HTTP ${res.status})`;
      lastHint = (json && json.hint) || 'Try Manual paste or a Facebook public video link.';
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'Relay timeout' : (e && e.message) || 'Relay unreachable';
      lastError = msg;
      lastHint =
        'Start scripts/local-relay.mjs, deploy worker/cors-relay.js, or use the Vercel /api/resolve function.';
    }
  }

  return { ok: false, via: endpoints[0]?.id || 'none', error: lastError, hint: lastHint };
}

/**
 * Client-side Facebook HTML extract via public proxies (no relay).
 * Works when a proxy can read facebook.com; often fails from browsers/datacenter IPs.
 */
export async function resolveFacebookViaProxies(pageUrl) {
  const { extractMediaFromHtml } = await import('./parser.js');
  if (!getProxyPref()) return { ok: false, error: 'Public proxies disabled' };

  for (const proxy of PUBLIC_PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy.wrap(pageUrl), {}, 15000);
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 500) continue;
      const items = extractMediaFromHtml(html).filter((i) => i.type === 'video' || i.url.includes('.mp4'));
      const all = items.length ? items : extractMediaFromHtml(html);
      if (all.length) {
        return { ok: true, items: all, source: `proxy:${proxy.id}`, via: proxy.id };
      }
    } catch {
      /* next proxy */
    }
  }
  return { ok: false, error: 'Public proxies could not fetch Facebook HTML' };
}

