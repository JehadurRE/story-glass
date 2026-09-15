import fs from 'node:fs';
import path from 'node:path';

const OUT = 'E:/JehadurRE/story-glass/research';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TARGET = process.argv[2] || 'https://www.instagram.com/hail_afgani/';

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
const cookieHeader = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');

function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = p.length % 4 === 0 ? '' : '='.repeat(4 - (p.length % 4));
    return JSON.parse(Buffer.from(p + pad, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function walk(o, acc = []) {
  if (!o) return acc;
  if (typeof o === 'string' && o.startsWith('http')) acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => walk(x, acc));
  else if (typeof o === 'object') {
    if (o.url) acc.push(o.url);
    Object.values(o).forEach((v) => walk(v, acc));
  }
  return acc;
}

async function bravedown(url) {
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
      Cookie: cookieHeader(cookies),
    },
    body: JSON.stringify({
      _token: csrf,
      components: [
        {
          snapshot: JSON.stringify(child),
          updates: { zlinkz: url },
          calls: [{ path: '', method: 'onDownload', params: [] }],
        },
      ],
    }),
  });
  const json = await res.json();
  const snap = JSON.parse(json.components[0].snapshot);
  return snap.data;
}

// --- BraveDown ---
console.log('=== BraveDown', TARGET, '===');
const bd = await bravedown(TARGET);
fs.writeFileSync(path.join(OUT, 'hail-bd.json'), JSON.stringify(bd, null, 2));
console.log('status', bd.status, 'message', bd.message);
console.log('stream_vid', bd.stream_vid, 'render_mode', bd.render_mode);

const urls = walk(bd.data);
console.log('url count', urls.length);
const decoded = [];
for (const u of urls) {
  if (u.includes('token=')) {
    const tok = u.split('token=')[1].split('&')[0];
    const payload = decodeJwt(tok);
    decoded.push(payload);
    console.log('JWT', payload?.type, payload?.filename?.slice(0, 60), '→', payload?.url?.slice(0, 90));
  } else {
    console.log('RAW', u.slice(0, 120));
  }
}
fs.writeFileSync(path.join(OUT, 'hail-jwt.json'), JSON.stringify(decoded, null, 2));

// Probe first tokened download + raw CDN
const tokened = urls.find((u) => u.includes('token='));
if (tokened) {
  const r = await fetch(tokened, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-2047' } });
  console.log('hcdn', r.status, r.headers.get('content-type'), r.headers.get('access-control-allow-origin'), r.headers.get('content-range'));
}
if (decoded[0]?.url) {
  const r2 = await fetch(decoded[0].url, { method: 'HEAD', headers: { 'User-Agent': UA } });
  console.log('raw CDN HEAD', r2.status, r2.headers.get('content-type'), 'acao', r2.headers.get('access-control-allow-origin'));
}

// --- Direct IG HTML ---
const ig = await fetch(TARGET, {
  headers: {
    'User-Agent': UA,
    Accept: 'text/html',
    'X-IG-App-ID': '936619743392459',
  },
});
const igHtml = await ig.text();
const norm = igHtml.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
const mp4 = [...new Set((norm.match(/https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))];
const jpg = [...new Set((norm.match(/https?:\/\/[^\s"'<>]+?\.jpe?g[^\s"'<>]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))]
  .filter((u) => /scontent|cdninstagram/i.test(u) && !/profile_pic|rsrc\.php/i.test(u));
console.log('\n=== Direct IG HTML ===');
console.log('status', ig.status, 'len', igHtml.length, 'mp4', mp4.length, 'story-like jpg', jpg.length);
if (jpg[0]) console.log('jpg sample', jpg[0].slice(0, 120));

// --- Local relay ---
console.log('\n=== Local relay ===');
try {
  const lr = await fetch(
    `http://127.0.0.1:8787/api/resolve?url=${encodeURIComponent(TARGET)}`
  );
  const lj = await lr.json();
  console.log(JSON.stringify({ ok: lj.ok, platform: lj.platform, n: lj.items?.length || 0, error: lj.error, source: lj.source }, null, 2));
  fs.writeFileSync(path.join(OUT, 'hail-local-relay.json'), JSON.stringify(lj, null, 2));
} catch (e) {
  console.log('local relay not running:', e.message);
}

console.log('\nSaved', path.join(OUT, 'hail-bd.json'));
