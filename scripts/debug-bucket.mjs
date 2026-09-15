const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const headers = {
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

const res = await fetch('https://www.facebook.com/fpvanik', { headers, redirect: 'follow' });
const html = await res.text();
const n = html
  .replace(/\\u002f/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/\\u0026/gi, '&')
  .replace(/&amp;/g, '&');

console.log('has story_bucket', n.includes('story_bucket'));
const idx = n.indexOf('"story_bucket"');
console.log('idx', idx);
const slice = n.slice(idx, idx + 500);
console.log(JSON.stringify(slice));

const pageId = (slice.match(/"id":"(\d{8,})","first_story_to_show"/) || [])[1];
console.log('pageId', pageId);
const firstRaw = (slice.match(/"first_story_to_show":\{"id":"([^"]+)"/) || [])[1];
console.log('firstRaw', firstRaw);
if (firstRaw) {
  const decoded = Buffer.from(firstRaw, 'base64').toString('utf8');
  console.log('decoded', decoded);
}
