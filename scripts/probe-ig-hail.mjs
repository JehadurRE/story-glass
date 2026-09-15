const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const USER = 'hail_afgani';
const USER_ID = '5461443048';

function cookieStr(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function normalize(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

function extract(html) {
  const n = normalize(html);
  const urls = new Set();
  for (const m of n.match(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|jpg|jpeg|webp)(?:\?[^\s"'<>\\]*)?/gi) || []) {
    const u = m.replace(/[),.;\]}]+$/, '');
    if (/scontent|cdninstagram|fbcdn/i.test(u) && !/rsrc\.php|profile_pic/i.test(u)) urls.add(u);
  }
  return [...urls];
}

const jar = {};
const home = await fetch('https://www.instagram.com/', {
  headers: { 'User-Agent': UA, Accept: 'text/html' },
});
for (const c of typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : []) {
  const [pair] = c.split(';');
  const i = pair.indexOf('=');
  if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
}
if (!jar.mid) jar.mid = 'Y' + Math.random().toString(36).slice(2, 22).toUpperCase();
if (!jar.ig_did) jar.ig_did = crypto.randomUUID().toUpperCase();
const csrf = jar.csrftoken || '';

// profile with session — this was larger
const prof = await fetch(`https://www.instagram.com/${USER}/`, {
  headers: {
    'User-Agent': UA,
    Accept: 'text/html',
    Cookie: cookieStr(jar),
    'X-IG-App-ID': '936619743392459',
  },
});
const profHtml = await prof.text();
const profUrls = extract(profHtml);
console.log('profile+session status', prof.status, 'len', profHtml.length, 'media urls', profUrls.length);
console.log(profUrls.slice(0, 8).map((u) => u.slice(0, 130)));

// Look for reels tray / stories JSON embedded
const hasReel = profHtml.includes('reels_media') || profHtml.includes('story_feed') || profHtml.includes('xdt_api__v1__feed__reels_media');
const hasItem = profHtml.includes('video_versions') || profHtml.includes('image_versions2');
console.log('embedded reels/story fields', hasReel, hasItem);

// Try story API with session + android UA
const storyRes = await fetch(`https://i.instagram.com/api/v1/feed/user/${USER_ID}/story/`, {
  headers: {
    'User-Agent':
      'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)',
    'X-IG-App-ID': '936619743392459',
    Accept: 'application/json',
    Cookie: cookieStr(jar),
    'X-CSRFToken': csrf,
  },
});
const storyText = await storyRes.text();
console.log('i.api story', storyRes.status, storyText.slice(0, 250));

// www graph-like
const gql = await fetch('https://www.instagram.com/graphql/query', {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-IG-App-ID': '936619743392459',
    'X-CSRFToken': csrf,
    Cookie: cookieStr(jar),
    Referer: `https://www.instagram.com/${USER}/`,
  },
  body: new URLSearchParams({
    av: '0',
    __d: 'dis',
    __user: '0',
    __a: '1',
    doc_id: '23996318473300828', // common reels tray doc - may be stale
    variables: JSON.stringify({ id: USER_ID, include_reel: true }),
  }),
});
const gqlText = await gql.text();
console.log('graphql', gql.status, gqlText.slice(0, 200));

// Save full profile html for offline mining
const fs = await import('node:fs');
fs.writeFileSync('E:/JehadurRE/story-glass/research/hail-profile-session.html', profHtml);
console.log('saved profile html');
