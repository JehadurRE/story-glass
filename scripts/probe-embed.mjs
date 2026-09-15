const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalize(html) {
  return html
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

function extractAll(html) {
  const n = normalize(html);
  const urls = new Set();
  for (const m of n.match(/https?:\/\/[^\s"'<>\\]+/gi) || []) {
    if (/cdninstagram|fbcdn|scontent|instagram\.com\/cdn-cgi/i.test(m)) {
      urls.add(m.replace(/[),.;\]}]+$/, ''));
    }
  }
  return [...urls];
}

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  return { status: res.status, text: await res.text() };
}

// Try several IG surfaces
const candidates = [
  'https://www.instagram.com/reel/C8cKQn8xKbJ/embed/',
  'https://www.instagram.com/p/B8ZRKU4B4Lq/embed/',
  'https://www.instagram.com/reel/CxYQyQ0tKxL/embed/',
];

for (const url of candidates) {
  const r = await get(url);
  const all = extractAll(r.text);
  const interesting = all.filter((u) => !/rsrc\.php|static\.cdninstagram\.com\/rsrc/i.test(u));
  console.log('\n==', url, 'status', r.status, 'len', r.text.length);
  console.log('interesting', interesting.length);
  for (const u of interesting.slice(0, 12)) console.log(' ', u.slice(0, 160));
  // look for JSON blobs
  const hasMediaJson = r.text.includes('video_url') || r.text.includes('image_versions') || r.text.includes('"display_url"');
  console.log('hasMediaJson fields', hasMediaJson);
}

// FB story / share formats
const fbUrls = [
  'https://www.facebook.com/facebook/videos/10153231379946729/',
  'https://www.facebook.com/reel/10153231379946729',
  'https://www.facebook.com/watch/?v=10153231379946729',
];
for (const url of fbUrls) {
  const r = await get(url);
  const n = normalize(r.text);
  const mp4s = [...new Set((n.match(/https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))];
  console.log('\nFB', url, r.status, 'mp4', mp4s.length, mp4s[0]?.slice(0, 100));
}
