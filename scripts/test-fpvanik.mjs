const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

const urls = [
  'https://www.facebook.com/fpvanik',
  'https://www.facebook.com/fpvanik/videos',
  'https://www.facebook.com/fpvanik/videos_by',
  'https://www.facebook.com/fpvanik/reels',
  'https://www.facebook.com/fpvanik/live',
  'https://m.facebook.com/fpvanik/videos',
];

for (const url of urls) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  const n = normalize(text);
  const mp4 = [...new Set((n.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []))];
  const named = [];
  const re =
    /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src|video_url)"\s*:\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(n))) named.push(normalize(m[1]).slice(0, 90));
  const videoIds = [...new Set([...n.matchAll(/\/videos\/(\d{8,})/g)].map((x) => x[1]))].slice(0, 8);
  const watchIds = [...new Set([...n.matchAll(/[?&]v=(\d{8,})/g)].map((x) => x[1]))].slice(0, 8);
  const title = (text.match(/<title[^>]*>([^<]+)/i) || [])[1];
  console.log(
    JSON.stringify({
      path: url.replace('https://www.facebook.com', '').replace('https://m.facebook.com', 'm:') || '/',
      status: res.status,
      len: text.length,
      mp4: mp4.length,
      named: named.length,
      videoIds,
      watchIds,
      title: title?.slice(0, 50),
      hasNoVideos: /no videos|doesn't have any videos/i.test(text),
    })
  );
  if (named[0]) console.log('  named0', named[0]);
  if (mp4[0]) console.log('  mp40', mp4[0].slice(0, 100));
}
