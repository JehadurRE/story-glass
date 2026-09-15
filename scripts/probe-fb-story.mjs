/**
 * Compare BraveDown current-story path for a FB page vs our HTML stories URL.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PAGE = process.argv[2] || 'fpvanik';

const FB_HEADERS = {
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

function normalize(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
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

// 1) Get page numeric id from profile HTML
const pageRes = await fetch(`https://www.facebook.com/${PAGE}`, { headers: FB_HEADERS, redirect: 'follow' });
const pageHtml = await pageRes.text();
const n = normalize(pageHtml);

const idCandidates = [];
for (const re of [
  /"page_id"\s*:\s*"?(\d{5,})"?/gi,
  /"entity_id"\s*:\s*"?(\d{5,})"?/gi,
  /profile_id=(\d{5,})/gi,
  /fb:\/\/page\/(\d+)/gi,
  /"userID"\s*:\s*"?(\d{5,})"?/gi,
  /content="fb:\/\/page\/(\d+)"/gi,
  /al:android:url" content="fb:\/\/profile\/(\d+)"/gi,
]) {
  let m;
  while ((m = re.exec(n))) idCandidates.push(m[1]);
}
const uniqueIds = [...new Set(idCandidates)].slice(0, 10);
console.log('page HTML ids', uniqueIds);
console.log('title', (pageHtml.match(/<title[^>]*>([^<]+)/i) || [])[1]);

// mobile often has fb://profile/ID
const mobile = await fetch(`https://www.facebook.com/${PAGE}`, {
  headers: {
    ...FB_HEADERS,
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  redirect: 'follow',
});
const mhtml = await mobile.text();
const mIds = [...new Set([...mhtml.matchAll(/fb:\/\/profile\/(\d+)/g)].map((x) => x[1]))];
const mIds2 = [...new Set([...mhtml.matchAll(/"page_id"\s*:\s*"?(\d{5,})"?/g)].map((x) => x[1]))];
console.log('mobile fb://profile ids', mIds, 'page_id', mIds2);

// 2) Try stories URLs with numeric ids
const storyIds = [...new Set([...uniqueIds, ...mIds, ...mIds2])];
for (const id of storyIds.slice(0, 4)) {
  for (const url of [
    `https://www.facebook.com/stories/${id}`,
    `https://www.facebook.com/stories/${id}/`,
  ]) {
    const res = await fetch(url, { headers: FB_HEADERS, redirect: 'follow' });
    const text = await res.text();
    const nn = normalize(text);
    const mp4 = [...new Set((nn.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))];
    const named = [];
    const re =
      /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src)"\s*:\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(nn))) named.push(normalize(m[1]).slice(0, 80));
    console.log(
      JSON.stringify({
        url: url.replace('https://www.facebook.com', ''),
        status: res.status,
        len: text.length,
        mp4: mp4.length,
        named: named.length,
        title: (text.match(/<title[^>]*>([^<]+)/i) || [])[1]?.slice(0, 40),
      })
    );
    if (mp4[0]) console.log('  mp4', mp4[0].slice(0, 110));
    if (named[0]) console.log('  named', named[0]);
  }
}

// 3) GraphQL / page stories endpoints sometimes used by web
for (const id of storyIds.slice(0, 2)) {
  const endpoints = [
    `https://www.facebook.com/api/graphql/`,
  ];
  // skip complex graphql for now

  // page permalink story bucket via mobile
  const touch = await fetch(`https://m.facebook.com/stories.php?story_id=${id}`, {
    headers: { 'User-Agent': FB_HEADERS['User-Agent'], Accept: 'text/html' },
    redirect: 'follow',
  });
  const tt = await touch.text();
  console.log('m stories.php', touch.status, tt.length, (tt.match(/\.mp4/g) || []).length);
}

// 4) BraveDown full payload
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

const bdPage = await fetch('https://bravedown.com/instagram-video-downloader', {
  headers: { 'User-Agent': UA, Accept: 'text/html' },
});
const bdHtml = await bdPage.text();
const bdCookies = parseSetCookie(bdPage);
const snaps = [...bdHtml.matchAll(/wire:snapshot="([^"]+)"/g)].map((m) =>
  JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"))
);
const csrf = (bdHtml.match(/data-csrf="([^"]+)"/) || [])[1];
const xsrf = decodeURIComponent(bdCookies['XSRF-TOKEN'] || '');
const child = snaps.find((s) => s.memo?.name === 'public.tool.downloader-public');
const bdRes = await fetch('https://bravedown.com/livewire/update', {
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
    Cookie: Object.entries(bdCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  },
  body: JSON.stringify({
    _token: csrf,
    components: [
      {
        snapshot: JSON.stringify(child),
        updates: { zlinkz: `https://www.facebook.com/${PAGE}` },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  }),
});
const bdJson = await bdRes.json();
const bdSnap = JSON.parse(bdJson.components[0].snapshot);
const data = bdSnap.data;
console.log('\n=== BraveDown ===');
console.log('status', data.status, 'message', data.message);
console.log('key', data.data?.[0]?.key);
console.log('title', data.data?.[0]?.title);
const urls = [];
(function walk(o) {
  if (!o) return;
  if (typeof o === 'string' && o.startsWith('http')) urls.push(o);
  else if (Array.isArray(o)) o.forEach(walk);
  else if (typeof o === 'object') {
    if (o.url) urls.push(o.url);
    Object.values(o).forEach(walk);
  }
})(data.data);
console.log('url count', urls.length);
for (const u of urls.slice(0, 3)) {
  if (u.includes('token=')) {
    const jwt = decodeJwt(u.split('token=')[1].split('&')[0]);
    console.log('JWT', jwt?.filename, jwt?.type, '→', (jwt?.url || '').slice(0, 100));
  }
}
