/**
 * Inspect BraveDown IG success payload for method clues.
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function parseSetCookie(res) {
  const jar = {};
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = p.length % 4 === 0 ? '' : '='.repeat(4 - (p.length % 4));
    return JSON.parse(Buffer.from(p + pad, 'base64').toString());
  } catch {
    return null;
  }
}

const USER = process.argv[2] || 'hail_afgani';

const pageRes = await fetch('https://bravedown.com/instagram-video-downloader', {
  headers: { 'User-Agent': UA, Accept: 'text/html' },
});
const html = await pageRes.text();
const cookies = parseSetCookie(pageRes);
const snapshots = [...html.matchAll(/wire:snapshot="([^"]+)"/g)].map((m) =>
  JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"))
);
const csrf = (html.match(/data-csrf="([^"]+)"/) || [])[1];
const xsrf = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
const child = snapshots.find((s) => s.memo?.name === 'public.tool.downloader-public');

const res = await fetch('https://bravedown.com/livewire/update', {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    Accept: 'text/html, application/xhtml+xml',
    'Content-Type': 'application/json',
    'X-Livewire': 'true',
    'X-CSRF-TOKEN': csrf,
    'X-XSRF-TOKEN': xsrf || csrf,
    'X-Requested-With': 'XMLHttpRequest',
    Origin: 'https://bravedown.com',
    Referer: 'https://bravedown.com/instagram-video-downloader',
    Cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  },
  body: JSON.stringify({
    _token: csrf,
    components: [
      {
        snapshot: JSON.stringify(child),
        updates: { zlinkz: `https://www.instagram.com/${USER}/` },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  }),
});

const json = await res.json();
const snap = JSON.parse(json.components[0].snapshot);
const data = snap.data;

fs.writeFileSync(
  'E:/JehadurRE/story-glass/research/bd-ig-full-snap.json',
  JSON.stringify(data, null, 2)
);

console.log('=== top-level keys ===');
console.log(Object.keys(data));
console.log('status', data.status, 'message', data.message);
console.log('render_mode', data.render_mode, 'stream_vid', data.stream_vid, 'stream_thumb', data.stream_thumb);
console.log('zlinkz', data.zlinkz);

console.log('\n=== data payload structure ===');
const payload = data.data;
console.log(JSON.stringify(payload, null, 2).slice(0, 4000));

// walk all objects for clues
const clues = [];
const walk = (o, path = '') => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) {
    o.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      if (/session|cookie|token|api|agent|proxy|residential|instagrapi|private|scrap|browser|playwright|puppeteer/i.test(k + v)) {
        clues.push({ path: p, value: v.slice(0, 200) });
      }
      if (v.startsWith('http') && /fbcdn|cdninstagram|bravedown|hcdn|kcdn|acdn/i.test(v)) {
        // skip bulk urls
      }
    } else if (v && typeof v === 'object') {
      walk(v, p);
    }
  }
};
walk(payload);

console.log('\n=== keyword clues ===');
console.log(clues.slice(0, 30));

// JWT analysis
const allUrls = [];
const walkUrls = (o) => {
  if (!o) return;
  if (typeof o === 'string' && o.startsWith('http')) allUrls.push(o);
  else if (Array.isArray(o)) o.forEach(walkUrls);
  else if (typeof o === 'object') {
    if (o.url) allUrls.push(o.url);
    Object.values(o).forEach(walkUrls);
  }
};
walkUrls(payload);

console.log('\n=== JWT / CDN analysis ===');
for (const u of [...new Set(allUrls)]) {
  if (u.includes('token=')) {
    const tok = u.split('token=')[1].split('&')[0];
    const jwt = decodeJwt(tok);
    console.log(JSON.stringify({ host: new URL(u).host, jwt }, null, 2));
  } else {
    console.log('RAW', u.slice(0, 140));
  }
}

// Try i.instagram.com from Node (same as BraveDown server would) with NO session vs guessing
console.log('\n=== i.instagram.com from this IP (no session) ===');
const ANDROID =
  'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)';
const story = await fetch('https://i.instagram.com/api/v1/feed/user/5461443048/story/', {
  headers: { 'User-Agent': ANDROID, 'X-IG-App-ID': '936619743392459', Accept: 'application/json' },
});
console.log(story.status, (await story.text()).slice(0, 200));

// Does BraveDown return story captions / timestamps that prove they parsed full story objects?
console.log('\n=== item metadata richness ===');
const items = [];
const collect = (o) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach(collect);
  if (o.filename || o.duration || o.type) items.push(Object.keys(o));
  Object.values(o).forEach(collect);
};
collect(payload);
console.log('sample item keys', items[0]);
