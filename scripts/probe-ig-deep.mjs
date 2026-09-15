/**
 * Deep-dive: how BraveDown gets IG stories for a public profile.
 * Compares multiple IG endpoints with and without anonymous cookies.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const ANDROID =
  'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)';

function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = p.length % 4 === 0 ? '' : '='.repeat(4 - (p.length % 4));
    return JSON.parse(Buffer.from(p + pad, 'base64').toString());
  } catch {
    return null;
  }
}

async function bootstrapIg() {
  const jar = {};
  const res = await fetch('https://www.instagram.com/', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
  });
  for (const c of typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  if (!jar.mid) jar.mid = 'Y' + Math.random().toString(36).slice(2, 22).toUpperCase();
  if (!jar.ig_did) jar.ig_did = crypto.randomUUID().toUpperCase();
  return jar;
}

function cookieStr(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function tryIg(name, url, { jar, ua = UA, extra = {} } = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        Accept: '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.instagram.com/',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(jar ? { Cookie: cookieStr(jar) } : {}),
        ...extra,
      },
      redirect: 'follow',
    });
    const text = await res.text();
    const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    let parsed = null;
    if (isJson) {
      try {
        parsed = JSON.parse(text);
      } catch {}
    }
    const mediaCount = isJson && parsed ? countMedia(parsed) : (text.match(/\.mp4/g) || []).length;
    console.log(
      JSON.stringify({
        name,
        status: res.status,
        len: text.length,
        isJson,
        mediaCount,
        msg: parsed?.message || parsed?.status || (text.match(/<title[^>]*>([^<]+)/i) || [])[1]?.slice(0, 40),
        head: isJson ? text.slice(0, 120) : undefined,
      })
    );
    return { status: res.status, text, parsed, isJson };
  } catch (e) {
    console.log(JSON.stringify({ name, error: String(e) }));
    return null;
  }
}

function countMedia(json) {
  let n = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.video_versions || o.image_versions2) n++;
    if (o.items) walk(o.items);
    if (o.reels) Object.values(o.reels).forEach(walk);
    if (o.tray) walk(o.tray);
    if (o.carousel_media) walk(o.carousel_media);
  };
  walk(json);
  return n;
}

const USER = process.argv[2] || 'hail_afgani';
const USER_ID = process.argv[3] || '5461443048';

console.log('=== bootstrap cookies ===');
const jar = await bootstrapIg();
console.log(Object.keys(jar));

console.log('\n=== IG endpoints ===');
await tryIg('web_profile_info+cookies', `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USER}`, {
  jar,
  extra: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' },
});
await tryIg('web_profile_info-nocookie', `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USER}`, {
  extra: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' },
});
await tryIg('i.story+cookies', `https://i.instagram.com/api/v1/feed/user/${USER_ID}/story/`, { jar, ua: ANDROID });
await tryIg('i.story-nocookie', `https://i.instagram.com/api/v1/feed/user/${USER_ID}/story/`, { ua: ANDROID });
await tryIg('i.reels_tray+cookies', 'https://i.instagram.com/api/v1/feed/reels_tray/', { jar, ua: ANDROID });
await tryIg('www.story+cookies', `https://www.instagram.com/api/v1/feed/user/${USER_ID}/story/`, { jar });
await tryIg('profile_html+cookies', `https://www.instagram.com/${USER}/`, { jar });
await tryIg('profile_html-nocookie', `https://www.instagram.com/${USER}/`);

// GraphQL doc_ids commonly used for profile/reels
const gqlBodies = [
  { name: 'gql-profile', doc_id: '8845758582119845', vars: { id: USER_ID, render_surface: 'PROFILE' } },
  { name: 'gql-reels', doc_id: '23996318473300828', vars: { id: USER_ID, include_reel: true } },
  { name: 'gql-user-reel', doc_id: '6546666792115634', vars: { user_id: USER_ID } },
];

for (const g of gqlBodies) {
  const res = await tryIg(g.name, 'https://www.instagram.com/graphql/query', {
    jar,
    extra: {
      method: 'POST',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': jar.csrftoken || '',
    },
  }).catch(() => null);
  // tryIg doesn't support POST body — do manually
}

for (const g of gqlBodies) {
  try {
    const res = await fetch('https://www.instagram.com/graphql/query', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-IG-App-ID': '936619743392459',
        'X-CSRFToken': jar.csrftoken || '',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookieStr(jar),
        Referer: `https://www.instagram.com/${USER}/`,
      },
      body: new URLSearchParams({
        av: '0',
        __d: 'dis',
        __user: '0',
        __a: '1',
        doc_id: g.doc_id,
        variables: JSON.stringify(g.vars),
      }),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    console.log(
      JSON.stringify({
        name: g.name,
        status: res.status,
        len: text.length,
        mediaCount: parsed ? countMedia(parsed) : 0,
        head: text.slice(0, 150),
      })
    );
  } catch (e) {
    console.log(g.name, e.message);
  }
}

console.log('\n=== BraveDown hail_afgani (reference) ===');
// reuse minimal livewire
function parseSetCookie(res) {
  const jar2 = {};
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar2[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar2;
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
        updates: { zlinkz: `https://www.instagram.com/${USER}/` },
        calls: [{ path: '', method: 'onDownload', params: [] }],
      },
    ],
  }),
});
const bdJson = await bdRes.json();
const bdSnap = JSON.parse(bdJson.components[0].snapshot);
console.log('status', bdSnap.data?.status, 'message', bdSnap.data?.message);
const urls = [];
(function walk(o) {
  if (!o) return;
  if (typeof o === 'string' && o.startsWith('http')) urls.push(o);
  else if (Array.isArray(o)) o.forEach(walk);
  else if (typeof o === 'object') {
    if (o.url) urls.push(o.url);
    Object.values(o).forEach(walk);
  }
})(bdSnap.data?.data);
console.log('items', urls.length);
for (const u of urls.slice(0, 4)) {
  if (u.includes('token=')) {
    const tok = u.split('token=')[1].split('&')[0];
    const payload = decodeJwt(tok);
    console.log('JWT', payload?.type, payload?.filename, '→', (payload?.url || '').slice(0, 100));
  }
}
