const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PAGE_ID = '100064764006031';

function normalize(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

function extractAll(html) {
  const n = normalize(html);
  const urls = new Set();
  for (const m of n.match(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|jpg|jpeg|webp)(?:\?[^\s"'<>\\]*)?/gi) || []) {
    const u = m.replace(/[),.;\]}]+$/, '');
    if (/fbcdn|scontent/i.test(u) && !/rsrc\.php/i.test(u)) urls.add(u);
  }
  return [...urls];
}

const targets = [
  `https://www.facebook.com/awomensoul`,
  `https://www.facebook.com/awomensoul/videos`,
  `https://www.facebook.com/awomensoul/reels`,
  `https://m.facebook.com/awomensoul`,
  `https://m.facebook.com/awomensoul/videos`,
  `https://m.facebook.com/${PAGE_ID}`,
  `https://www.facebook.com/${PAGE_ID}`,
  `https://www.facebook.com/${PAGE_ID}/videos`,
  `https://www.facebook.com/pages/A-women-soul/${PAGE_ID}`,
  `https://www.facebook.com/awomensoul/videos_by`,
  `https://www.facebook.com/awomensoul/live_videos`,
];

for (const url of targets) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA_MOBILE,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const text = await res.text();
  const media = extractAll(text);
  const mp4 = media.filter((u) => u.includes('.mp4'));
  const jpg = media.filter((u) => /\.jpe?g/i.test(u));
  const videoIds = [...new Set([...text.matchAll(/\/videos\/(\d{8,})/g)].map((m) => m[1]))].slice(0, 5);
  const watchIds = [...new Set([...text.matchAll(/[?&]v=(\d{8,})/g)].map((m) => m[1]))].slice(0, 5);
  console.log(
    JSON.stringify({
      url: url.replace('https://www.facebook.com', '').replace('https://m.facebook.com', 'm:') || '/',
      status: res.status,
      len: text.length,
      mp4: mp4.length,
      jpg: jpg.length,
      videoIds,
      watchIds,
      title: (text.match(/<title[^>]*>([^<]{0,60})/i) || [])[1],
    })
  );
}
