const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function grab(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json', ...headers },
    redirect: 'follow',
  });
  const text = await res.text();
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    acao: res.headers.get('access-control-allow-origin'),
    len: text.length,
    text,
    setCookie: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
  };
}

function extractMp4(html) {
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  const urls = new Set();
  for (const m of normalized.match(/https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*/gi) || []) {
    urls.add(m.replace(/[),.;]+$/, ''));
  }
  return [...urls];
}

const results = [];

// IG embed
const embed = await grab('https://www.instagram.com/p/B8ZRKU4B4Lq/embed/captioned/');
results.push({
  name: 'embed',
  status: embed.status,
  len: embed.len,
  mp4: extractMp4(embed.text).slice(0, 3),
  hasScontent: /scontent|cdninstagram/.test(embed.text),
});

// IG session
const jar = {};
const home = await grab('https://www.instagram.com/');
for (const c of home.setCookie) {
  const [pair] = c.split(';');
  const i = pair.indexOf('=');
  if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
}
const cookie = Object.entries(jar)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ');
results.push({ name: 'session', keys: Object.keys(jar), homeStatus: home.status });

const post = await grab('https://www.instagram.com/p/B8ZRKU4B4Lq/', {
  Cookie: cookie,
  'X-IG-App-ID': '936619743392459',
});
results.push({
  name: 'post+session',
  status: post.status,
  len: post.len,
  mp4: extractMp4(post.text).slice(0, 3),
  hasVideoVersions: post.text.includes('video_versions'),
  hasScontent: /scontent|cdninstagram/.test(post.text),
});

// embed with session
const embed2 = await grab('https://www.instagram.com/p/B8ZRKU4B4Lq/embed/captioned/', { Cookie: cookie });
results.push({
  name: 'embed+session',
  status: embed2.status,
  len: embed2.len,
  mp4: extractMp4(embed2.text).slice(0, 5),
  hasScontent: /scontent|cdninstagram/.test(embed2.text),
});

// media info with session
const info = await grab('https://www.instagram.com/api/v1/media/3390000000000000000/info/', {
  Cookie: cookie,
  'X-IG-App-ID': '936619743392459',
});
results.push({
  name: 'media-info+session',
  status: info.status,
  type: info.type,
  head: info.text.slice(0, 200),
});

// FB
const fb = await grab('https://www.facebook.com/facebook/videos/10153231379946729/', {
  Accept: 'text/html',
});
const fbMp4 = extractMp4(fb.text);
results.push({
  name: 'fb-video',
  status: fb.status,
  len: fb.len,
  mp4Count: fbMp4.length,
  mp4: fbMp4.slice(0, 3).map((u) => u.slice(0, 120)),
  hasPlayable: fb.text.includes('playable_url') || fb.text.includes('browser_native'),
});

// m.facebook
const mfb = await grab('https://m.facebook.com/facebook/videos/10153231379946729/');
results.push({
  name: 'm-fb',
  status: mfb.status,
  len: mfb.len,
  mp4Count: extractMp4(mfb.text).length,
});

// FB story share format
const fbs = await grab('https://www.facebook.com/share/r/xyz/');
results.push({ name: 'fb-share', status: fbs.status, len: fbs.len });

console.log(JSON.stringify(results, null, 2));
