/**
 * First-party only: can we get live-story media without any session?
 * Parse profile HTML thoroughly for story media / deferred payloads.
 */
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

function norm(s) {
  return String(s)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

const res = await fetch(`https://www.facebook.com/${PAGE}`, { headers: H, redirect: 'follow' });
const html = await res.text();
const n = norm(html);

console.log('len', n.length);

// story_bucket block larger
const sb = n.indexOf('"story_bucket"');
const block = n.slice(sb, sb + 4000);
console.log('--- story_bucket+4k ---');
console.log(block.slice(0, 2000));

// search for video/image near first_story
const keys = ['videoDeliveryLegacyFields', 'image1080', 'image640', 'image480', 'browserNativeHdUrl', 'browser_native', 'playable_url', 'cdnUrl', 'preferred_thumbnail', 'thumbnailImage', 'attachments', 'story_card', 'media'];
for (const k of keys) {
  const c = (n.match(new RegExp(k, 'gi')) || []).length;
  if (c) console.log('key', k, c);
}

// all script type application/json with story
const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('json scripts', scripts.length);
let found = 0;
for (const s of scripts) {
  const body = s[1];
  if (body.includes('story_bucket') || body.includes('first_story') || body.includes('StoryVideo')) {
    found++;
    const nn = norm(body);
    const mp4 = (nn.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).slice(0, 3);
    const jpg = (nn.match(/https?:\/\/[^\s"'<>\\]+?\.jpg[^\s"'<>\\]*/gi) || [])
      .filter((u) => /fbcdn|scontent/i.test(u) && !/profile_pic/i.test(u))
      .slice(0, 3);
    console.log('script hit', found, 'len', body.length, 'mp4', mp4.length, 'jpg', jpg.length);
    if (mp4[0]) console.log(' mp4', mp4[0].slice(0, 120));
    if (jpg[0]) console.log(' jpg', jpg[0].slice(0, 120));
    // print window around first_story if media-looking
    const i2 = nn.indexOf('first_story');
    if (i2 >= 0) console.log(nn.slice(i2, i2 + 600).slice(0, 600));
  }
}

// try photo.php / video.php with story id
const first = n.match(/"first_story_to_show":\{"id":"([^"]+)"/);
if (first) {
  const decoded = Buffer.from(first[1], 'base64').toString('utf8');
  const sid = decoded.match(/(\d{8,})/)?.[1];
  console.log('story id', sid);
  for (const url of [
    `https://www.facebook.com/photo.php?fbid=${sid}`,
    `https://www.facebook.com/photo/?fbid=${sid}`,
    `https://www.facebook.com/video.php?v=${sid}`,
    `https://www.facebook.com/${sid}`,
  ]) {
    const r = await fetch(url, { headers: H, redirect: 'follow' });
    const t = norm(await r.text());
    const mp4 = (t.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).length;
    const named = (t.match(/browser_native|playable_url|hd_src/g) || []).length;
    const jpg = (t.match(/https?:\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg)[^\s"'<>\\]*/gi) || [])
      .filter((u) => /fbcdn|scontent/i.test(u) && !/safe_image|profile/i.test(u)).length;
    console.log(JSON.stringify({ url: url.replace('https://www.facebook.com', ''), status: r.status, len: t.length, mp4, named, jpg }));
  }
}
