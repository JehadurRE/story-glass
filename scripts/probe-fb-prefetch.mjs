const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const H = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const PAGE = process.argv[2] || 'fpvanik';
const res = await fetch(`https://www.facebook.com/${PAGE}`, { headers: H, redirect: 'follow' });
const html = await res.text();
const n = html
  .replace(/\\u002f/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/\\u0026/gi, '&')
  .replace(/&amp;/g, '&');

// all prefetch_uris
const pref = [...n.matchAll(/"prefetch_uris_v2":\[(.*?)\]/g)];
console.log('prefetch blocks', pref.length);
const uris = new Set();
for (const m of pref) {
  for (const u of m[1].match(/https?:\/\/[^"\s]+/g) || []) {
    uris.add(u.replace(/\\u0026/g, '&'));
  }
}
console.log('uris', uris.size);
for (const u of [...uris].slice(0, 12)) {
  const isStoryish = /t39\.30808|story/i.test(u);
  console.log(isStoryish ? 'STORY?' : 'other', u.slice(0, 130));
}

// HEAD a story-like jpg
const storyUris = [...uris].filter((u) => /t39\.30808|\.jpg/i.test(u) && !/profile_pic/i.test(u));
if (storyUris[0]) {
  const r = await fetch(storyUris[0], { method: 'HEAD', headers: { 'User-Agent': UA } });
  console.log('HEAD', r.status, r.headers.get('content-type'), r.headers.get('access-control-allow-origin'));
}
