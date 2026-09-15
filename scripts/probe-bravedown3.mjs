/** Try multiple public URL shapes against BraveDown Livewire. */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'E:/JehadurRE/story-glass/research';
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

async function session() {
  const res = await fetch('https://bravedown.com/instagram-video-downloader', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  const html = await res.text();
  const cookies = parseSetCookie(res);
  const snapshots = [...html.matchAll(/wire:snapshot="([^"]+)"/g)].map((m) =>
    JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"))
  );
  const csrf = (html.match(/data-csrf="([^"]+)"/) || [])[1];
  const xsrf = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
  const child = snapshots.find((s) => s.memo?.name === 'public.tool.downloader-public');
  return { cookies, csrf, xsrf, child, html };
}

async function submit(sess, url) {
  const body = {
    _token: sess.csrf,
    components: [
      {
        snapshot: JSON.stringify(sess.child),
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
      'X-CSRF-TOKEN': sess.csrf,
      'X-XSRF-TOKEN': sess.xsrf || sess.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://bravedown.com',
      Referer: 'https://bravedown.com/instagram-video-downloader',
      Cookie: cookieHeader(sess.cookies),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let summary = { url, status: res.status };
  try {
    const json = JSON.parse(text);
    const snap = JSON.parse(json.components[0].snapshot);
    summary = {
      url,
      http: res.status,
      status: snap.data?.status,
      message: snap.data?.message,
      hasData: Boolean(snap.data?.data),
      dataPreview: JSON.stringify(snap.data?.data || null).slice(0, 400),
      stream_vid: snap.data?.stream_vid,
      stream_thumb: snap.data?.stream_thumb,
    };
  } catch {
    summary.body = text.slice(0, 200);
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const targets = [
  // classic shortcodes (may or may not resolve)
  'https://www.instagram.com/p/B8ZRKU4B4Lq/',
  'https://www.instagram.com/p/Cx1ZQ12t5xL/',
  'https://www.instagram.com/reel/C8cKQn8xKbJ/',
  'https://www.instagram.com/p/C8cKQn8xKbJ/',
  'https://www.instagram.com/tv/C8cKQn8xKbJ/',
  // facebook public video
  'https://www.facebook.com/facebook/videos/10153231379946729/',
  'https://fb.watch/abc/',
  // profile
  'https://www.instagram.com/nasa/',
];

const sess = await session();
console.log('session child id', sess.child?.memo?.id, 'csrf', !!sess.csrf);

const results = [];
for (const t of targets) {
  // fresh session per request to avoid weird state / soft bans on same wire id?
  try {
    const s = await session();
    const r = await submit(s, t);
    results.push(r);
  } catch (e) {
    results.push({ url: t, error: String(e) });
  }
  await new Promise((r) => setTimeout(r, 800));
}

fs.writeFileSync(path.join(OUT, 'bravedown-batch.json'), JSON.stringify(results, null, 2));
console.log('\nWrote bravedown-batch.json');
