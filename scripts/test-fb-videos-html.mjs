const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const res = await fetch('https://www.facebook.com/awomensoul/videos', {
  headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html' },
  redirect: 'follow',
});
const html = await res.text();
console.log('len', html.length, 'status', res.status);

// save
const fs = await import('node:fs');
fs.writeFileSync('E:/JehadurRE/story-glass/research/awomensoul-videos.html', html);

// interesting patterns
const patterns = [
  /video_id["':\s]+(\d{8,})/gi,
  /"videoID"\s*:\s*"?(\d+)/gi,
  /\/watch\/\?v=(\d+)/gi,
  /story_fbid=(\d+)/gi,
  /"story_token"\s*:\s*"([^"]+)"/gi,
  /topLevelVideo/gi,
  /page_video/gi,
  /VideoCard/gi,
  /permalink/gi,
];
for (const re of patterns) {
  const hits = [...html.matchAll(re)].slice(0, 5).map((m) => m[0].slice(0, 80));
  if (hits.length) console.log(re.source, hits);
}

// dump text-ish
const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('TEXT', text.slice(0, 800));
console.log('SCRIPTS', (html.match(/<script/g) || []).length);
// hrefs
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /video|watch|reel|story/i.test(h)).slice(0, 20);
console.log('hrefs', hrefs);
