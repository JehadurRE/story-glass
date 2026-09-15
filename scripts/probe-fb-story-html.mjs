const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const FB_HEADERS = {
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

const res = await fetch('https://www.facebook.com/fpvanik', { headers: FB_HEADERS, redirect: 'follow' });
const html = await res.text();
const n = html
  .replace(/\\u002f/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/\\u0026/gi, '&')
  .replace(/&amp;/g, '&');

// find story_bucket contexts
let idx = 0;
let count = 0;
while ((idx = n.indexOf('story_bucket', idx)) !== -1 && count < 8) {
  const start = Math.max(0, idx - 120);
  const slice = n.slice(start, idx + 200).replace(/\s+/g, ' ');
  console.log('CTX', count, slice.slice(0, 280));
  idx += 12;
  count++;
}

console.log('\n--- other story keys ---');
for (const key of ['unified_stories', 'stories_bucket', 'story_card', 'page_story', 'active_stories', 'has_stories', 'is_story', 'StoryCard', 'story_id', 'story_fbid']) {
  const c = (n.match(new RegExp(key, 'gi')) || []).length;
  if (c) console.log(key, c);
}

// extract JSON-looking story objects
const storyJson = n.match(/\{[^{}]{0,40}story[^{}]{0,200}\}/gi) || [];
console.log('\nstory json snippets', storyJson.length);
storyJson.slice(0, 5).forEach((s) => console.log(s.slice(0, 200)));

// find video ids near story
const nearby = [...n.matchAll(/.{0,80}story.{0,120}/gi)].slice(0, 10).map((m) => m[0].replace(/\s+/g, ' ').slice(0, 180));
console.log('\nnearby story text:');
nearby.forEach((s) => console.log(' ', s));
