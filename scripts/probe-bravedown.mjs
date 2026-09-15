/**
 * Probe BraveDown Livewire onDownload + public IG endpoints.
 * Educational reverse-engineering of publicly exposed frontend behavior.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'E:/JehadurRE/story-glass/research';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Public Instagram reel (NASA) — widely shared public content
const TEST_IG_URLS = [
  'https://www.instagram.com/reel/C8cKQn8xKbJ/',
  'https://www.instagram.com/p/C8cKQn8xKbJ/',
];

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  console.log('saved', name, typeof data === 'string' ? data.length : JSON.stringify(data).length);
}

function parseSetCookie(res) {
  const jar = {};
  // getSetCookie may exist on Headers
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function step1GetPage() {
  const res = await fetch('https://bravedown.com/instagram-video-downloader', {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  const cookies = parseSetCookie(res);
  save('bd-page.html', html);
  save('bd-cookies.json', cookies);

  const snapMatches = [...html.matchAll(/wire:snapshot="([^"]+)"/g)].map((m) =>
    m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'")
  );
  const csrf = (html.match(/data-csrf="([^"]+)"/) || [])[1];
  const xsrf = decodeURIComponent(cookies['XSRF-TOKEN'] || '');

  console.log('status', res.status);
  console.log('cookies', Object.keys(cookies));
  console.log('csrf meta', csrf);
  console.log('snapshots', snapMatches.length);
  snapMatches.forEach((s, i) => console.log(`snap[${i}]`, s.slice(0, 300)));

  return { html, cookies, csrf, snapshots: snapMatches, xsrf };
}

async function step2LivewireOnDownload(page, igUrl) {
  // Parent component is public.page-tool; child downloader holds zlinkz
  const snapshots = page.snapshots.map((s) => JSON.parse(s));
  const child = snapshots.find((s) => s.memo && s.memo.name === 'public.tool.downloader-public');
  if (!child) throw new Error('downloader snapshot not found');

  const payload = {
    _token: page.csrf,
    components: [
      {
        snapshot: JSON.stringify({
          ...child,
          data: { ...child.data, zlinkz: igUrl },
        }),
        updates: { zlinkz: igUrl },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  };

  save('livewire-request.json', payload);

  const res = await fetch('https://bravedown.com/livewire/update', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html, application/xhtml+xml',
      'Content-Type': 'application/json',
      'X-Livewire': 'true',
      'X-CSRF-TOKEN': page.csrf || '',
      'X-XSRF-TOKEN': page.xsrf || page.csrf || '',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://bravedown.com',
      Referer: 'https://bravedown.com/instagram-video-downloader',
      Cookie: cookieHeader(page.cookies),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  save('livewire-response.txt', text);
  console.log('\n=== Livewire status', res.status, '===');
  console.log(text.slice(0, 2500));
  return { status: res.status, text };
}

async function step3ProbeIgDirect() {
  const targets = [
    'https://www.instagram.com/reel/C8cKQn8xKbJ/',
    'https://www.instagram.com/api/v1/media/3390000000000000000/info/',
    'https://www.instagram.com/p/C8cKQn8xKbJ/?__a=1&__d=dis',
  ];
  const results = [];
  for (const url of targets) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          'X-IG-App-ID': '936619743392459',
        },
        redirect: 'follow',
      });
      const text = await res.text();
      results.push({
        url,
        status: res.status,
        contentType: res.headers.get('content-type'),
        cors: res.headers.get('access-control-allow-origin'),
        len: text.length,
        head: text.slice(0, 200),
      });
    } catch (e) {
      results.push({ url, error: String(e) });
    }
  }
  save('ig-direct.json', results);
  console.log('\n=== IG direct (Node fetch, no browser CORS) ===');
  console.log(JSON.stringify(results, null, 2));
}

async function step4PublicProxies(igUrl) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(igUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(igUrl)}`,
  ];
  const results = [];
  for (const url of proxies) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const text = await res.text();
      results.push({
        proxy: url.split('?')[0],
        status: res.status,
        len: text.length,
        head: text.slice(0, 180),
      });
    } catch (e) {
      results.push({ proxy: url, error: String(e) });
    }
  }
  save('ig-proxies.json', results);
  console.log('\n=== Public CORS proxies ===');
  console.log(JSON.stringify(results, null, 2));
}

const igUrl = process.argv[2] || TEST_IG_URLS[0];
console.log('Using IG URL', igUrl);

const page = await step1GetPage();
await step2LivewireOnDownload(page, igUrl);
await step3ProbeIgDirect();
await step4PublicProxies(igUrl);
console.log('\nDone. Artifacts in', OUT);
