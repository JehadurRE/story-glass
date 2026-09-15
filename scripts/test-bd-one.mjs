import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const URL = process.argv[2] || 'https://www.facebook.com/awomensoul';

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
        updates: { zlinkz: URL },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  }),
});
const json = await res.json();
const snap = JSON.parse(json.components[0].snapshot);
console.log('url', URL);
console.log('status', snap.data?.status, 'message', snap.data?.message);
console.log('data', JSON.stringify(snap.data?.data).slice(0, 500));
