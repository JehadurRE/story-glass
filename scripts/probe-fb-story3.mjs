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
const n = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');

const STORY_ID = '1391279903214514';
const PAGE_ID = '2018396421522448';

// all occurrences of story id
let idx = 0;
let c = 0;
while ((idx = n.indexOf(STORY_ID, idx)) !== -1 && c < 15) {
  console.log('AT', idx, n.slice(Math.max(0, idx - 60), idx + 180).replace(/\s+/g, ' ').slice(0, 220));
  idx += STORY_ID.length;
  c++;
}
console.log('count', c);

// first_story_to_show larger object - find end of first_story_to_show
const fsi = n.indexOf('first_story_to_show');
console.log('\nfirst_story_to_show block:\n', n.slice(fsi, fsi + 1500));

// try graphql story query used by comet
const queries = [
  {
    name: 'story-card',
    body: new URLSearchParams({
      av: '0',
      __user: '0',
      __a: '1',
      doc_id: '7409518162399913',
      variables: JSON.stringify({ storyID: STORY_ID, scale: 1 }),
    }),
  },
  {
    name: 'story-ring',
    body: new URLSearchParams({
      av: '0',
      __user: '0',
      __a: '1',
      doc_id: '2519497838176949',
      variables: JSON.stringify({ pageID: PAGE_ID }),
    }),
  },
];

for (const q of queries) {
  try {
    const r = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers: {
        ...FB_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.facebook.com',
        Referer: 'https://www.facebook.com/fpvanik',
      },
      body: q.body,
    });
    const t = await r.text();
    console.log(q.name, r.status, t.slice(0, 180), 'mp4', (t.match(/\.mp4/g) || []).length, 'len', t.length);
  } catch (e) {
    console.log(q.name, e.message);
  }
}
