/**
 * Livewire v3-correct probe: keep snapshot intact, apply via updates.
 * Also mine media URLs from Instagram HTML responses.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'E:/JehadurRE/story-glass/research';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const IG_URL = process.argv[2] || 'https://www.instagram.com/reel/C8cKQn8xKbJ/';

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  console.log('saved', name);
}

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

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractMediaUrls(html) {
  const normalized = html
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|jpg|jpeg|webp)(?:\?[^\s"'<>\\]*)?/gi;
  for (const m of normalized.match(re) || []) {
    if (/cdninstagram|fbcdn|scontent/i.test(m)) urls.add(m);
  }
  return [...urls];
}

async function getPage() {
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
  return { html, cookies, snapshots, csrf, xsrf };
}

async function tryLivewire(page, variant) {
  const child = page.snapshots.find((s) => s.memo?.name === 'public.tool.downloader-public');
  const parent = page.snapshots.find((s) => s.memo?.name === 'public.page-tool');
  if (!child) throw new Error('no child');

  let body;
  if (variant === 'updates-only') {
    body = {
      _token: page.csrf,
      components: [
        {
          snapshot: JSON.stringify(child), // untouched checksum
          updates: { zlinkz: IG_URL },
          calls: [{ path: '', method: 'onDownload', params: [] }],
        },
      ],
    };
  } else if (variant === 'call-only') {
    body = {
      _token: page.csrf,
      components: [
        {
          snapshot: JSON.stringify(child),
          updates: {},
          calls: [{ path: '', method: 'onDownload', params: [IG_URL] }],
        },
      ],
    };
  } else if (variant === 'update-then-call') {
    // two-step mental model: first sync model, but single request with both is common
    body = {
      components: [
        {
          snapshot: JSON.stringify(child),
          updates: { zlinkz: IG_URL },
          calls: [{ path: '', method: 'onDownload', params: [] }],
        },
      ],
    };
  } else if (variant === 'parent+child') {
    // rebuild parent snapshot children intact
    body = {
      _token: page.csrf,
      components: [
        {
          snapshot: JSON.stringify(parent),
          updates: {},
          calls: [],
        },
        {
          snapshot: JSON.stringify(child),
          updates: { zlinkz: IG_URL },
          calls: [{ path: '', method: 'onDownload', params: [] }],
        },
      ],
    };
  }

  save(`lw-req-${variant}.json`, body);

  const res = await fetch('https://bravedown.com/livewire/update', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html, application/xhtml+xml',
      'Content-Type': 'application/json',
      'X-Livewire': 'true',
      'X-CSRF-TOKEN': page.csrf,
      'X-XSRF-TOKEN': page.xsrf || page.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://bravedown.com',
      Referer: 'https://bravedown.com/instagram-video-downloader',
      Cookie: cookieHeader(page.cookies),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  save(`lw-res-${variant}.txt`, text);
  console.log(`\n=== ${variant} → HTTP ${res.status} len=${text.length} ===`);
  // show non-HTML error snippets or JSON
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    console.log(text.slice(0, 2000));
  } else {
    const err = text.match(/exception|message|error|Whoops|Livewire[^<]{0,200}/gi);
    console.log((err || []).slice(0, 8).join(' | '));
    console.log(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));
  }
  return { status: res.status, text };
}

async function mineIgHtml() {
  const res = await fetch(IG_URL, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await res.text();
  save('ig-reel.html', html);
  const media = extractMediaUrls(html);
  save('ig-reel-media.json', media);
  console.log('\n=== IG reel page ===');
  console.log('status', res.status, 'html', html.length, 'media urls', media.length);
  console.log(media.slice(0, 8));

  // also try graphql-ish embedded
  const hasVideo = /video_url|video_versions|playable_url/i.test(html);
  const hasLogin = /login|Log in|not logged in/i.test(html.slice(0, 5000));
  console.log('hasVideoFields', hasVideo, 'loginHints', hasLogin);
}

const page = await getPage();
console.log('page ok, snapshots', page.snapshots.map((s) => s.memo?.name));

for (const v of ['updates-only', 'call-only', 'update-then-call']) {
  try {
    await tryLivewire(page, v);
  } catch (e) {
    console.error(v, e);
  }
}

await mineIgHtml();
