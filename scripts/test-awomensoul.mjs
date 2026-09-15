const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
    if (/fbcdn|scontent|cdninstagram/i.test(u) && !/rsrc\.php|profile_pic/i.test(u)) urls.add(u);
  }
  return [...urls];
}

const TARGETS = [
  'https://www.facebook.com/awomensoul',
  'https://www.facebook.com/awomensoul/',
  'https://m.facebook.com/awomensoul',
  'https://www.facebook.com/awomensoul/videos',
  'https://www.facebook.com/awomensoul/videos/',
  'https://www.facebook.com/awomensoul/reels',
  'https://www.facebook.com/awomensoul/posts',
  'https://www.facebook.com/awomensoul/live',
  'https://www.facebook.com/awomensoul/photos',
];

for (const url of TARGETS) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const text = await res.text();
    const media = extract(text);
    const mp4 = media.filter((u) => u.includes('.mp4'));
    const named = [];
    const re =
      /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src|video_url)"\s*:\s*"([^"]+)"/gi;
    let m;
    const n = normalize(text);
    while ((m = re.exec(n))) named.push(m[1].slice(0, 80));
    console.log(
      JSON.stringify({
        url,
        status: res.status,
        final: res.url?.slice(0, 80),
        len: text.length,
        mp4: mp4.length,
        named: named.length,
        title: (text.match(/<title[^>]*>([^<]{0,80})/i) || [])[1],
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ url, error: String(e) }));
  }
}
