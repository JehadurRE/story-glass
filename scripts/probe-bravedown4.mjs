import fs from 'node:fs';
import path from 'node:path';

const batch = JSON.parse(fs.readFileSync('E:/JehadurRE/story-glass/research/bravedown-batch.json', 'utf8'));
const fb = batch.find((r) => r.url.includes('facebook/videos'));
const ig = batch.find((r) => r.url.includes('instagram.com/nasa'));

console.log('=== FB summary ===');
console.log(JSON.stringify(fb, null, 2));
console.log('=== IG profile summary ===');
console.log(JSON.stringify(ig, null, 2));

// Re-fetch full JSON for the two successes
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
const cookieHeader = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');

async function resolve(url) {
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

  const body = {
    _token: csrf,
    components: [
      {
        snapshot: JSON.stringify(child),
        updates: { zlinkz: url },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  };

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
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const snap = JSON.parse(json.components[0].snapshot);
  return { data: snap.data, html: json.components[0].effects?.html || '' };
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  try {
    return JSON.parse(Buffer.from(payload + pad, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function walkLinks(data) {
  const urls = [];
  const stack = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (typeof cur === 'string' && cur.startsWith('http')) urls.push(cur);
    else if (Array.isArray(cur)) stack.push(...cur);
    else if (typeof cur === 'object') {
      if (cur.url) urls.push(cur.url);
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return [...new Set(urls)];
}

for (const [name, url] of [
  ['fb', 'https://www.facebook.com/facebook/videos/10153231379946729/'],
  ['ig-profile', 'https://www.instagram.com/nasa/'],
]) {
  console.log('\n########', name, '########');
  const r = await resolve(url);
  fs.writeFileSync(`E:/JehadurRE/story-glass/research/full-${name}.json`, JSON.stringify(r.data, null, 2));
  fs.writeFileSync(`E:/JehadurRE/story-glass/research/full-${name}.html`, r.html);

  console.log('status', r.data.status, 'message', r.data.message);
  console.log('render_mode', r.data.render_mode, 'stream_vid', r.data.stream_vid, 'stream_thumb', r.data.stream_thumb);

  const urls = walkLinks(r.data.data);
  console.log('url count', urls.length);
  for (const u of urls.slice(0, 6)) {
    if (u.includes('token=')) {
      const tok = u.split('token=')[1];
      const decoded = decodeJwt(tok);
      console.log('TOKENED:', u.slice(0, 80) + '...');
      console.log('  JWT payload:', JSON.stringify(decoded));
    } else {
      console.log('RAW:', u.slice(0, 140));
    }
  }

  // probe hcdn download headers
  const hcdn = urls.find((u) => u.includes('hcdn.bravedown.com'));
  if (hcdn) {
    const head = await fetch(hcdn, { method: 'GET', headers: { 'User-Agent': UA } });
    console.log('hcdn GET status', head.status, 'type', head.headers.get('content-type'), 'len', head.headers.get('content-length'), 'acao', head.headers.get('access-control-allow-origin'));
  }
}

// also try facebook story URL format they advertise
console.log('\n######## fb story format ########');
const story = await resolve('https://www.facebook.com/stories/10153231379946729');
console.log(story.data.status, story.data.message, JSON.stringify(story.data.data).slice(0, 300));
