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

function normalize(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

const PAGE_ID = process.argv[2] || '2018396421522448';
const HANDLE = process.argv[3] || 'fpvanik';

const urls = [
  `https://www.facebook.com/stories/${PAGE_ID}`,
  `https://www.facebook.com/${PAGE_ID}`,
  `https://www.facebook.com/${HANDLE}`,
  `https://www.facebook.com/${HANDLE}/stories`,
  `https://www.facebook.com/pages/${PAGE_ID}`,
  `https://www.facebook.com/page.php?id=${PAGE_ID}`,
  `https://www.facebook.com/plugins/page.php?href=https://www.facebook.com/${HANDLE}`,
];

for (const url of urls) {
  const res = await fetch(url, { headers: FB_HEADERS, redirect: 'follow' });
  const text = await res.text();
  const n = normalize(text);
  const mp4 = [...new Set((n.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))];
  const named = [];
  const re =
    /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src|playable_url_dash)"\s*:\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(n))) named.push(normalize(m[1]));
  const ids = [...new Set([...n.matchAll(/(?:page_id|entity_id|profile_id)["':\s]+(\d{8,})/gi)].map((x) => x[1]))].slice(0, 5);
  const storyBucket = n.includes('story_bucket') || n.includes('stories_bucket') || n.includes('unified_stories');
  console.log(
    JSON.stringify({
      path: url.replace('https://www.facebook.com', '') || '/',
      status: res.status,
      len: text.length,
      mp4: mp4.length,
      named: named.length,
      ids,
      storyBucket,
      title: (text.match(/<title[^>]*>([^<]+)/i) || [])[1]?.slice(0, 45),
    })
  );
  if (mp4[0]) console.log('  mp4', mp4[0].slice(0, 100));
  if (named[0]) console.log('  named0', named[0].slice(0, 100));
}

// try GraphQL page stories (web)
const gqlBody = {
  av: '0',
  __user: '0',
  __a: '1',
  doc_id: '293527572654019', // may be stale
  variables: JSON.stringify({ pageID: PAGE_ID }),
};
try {
  const g = await fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST',
    headers: {
      ...FB_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(gqlBody),
  });
  const gt = await g.text();
  console.log('gql', g.status, gt.slice(0, 150), 'mp4', (gt.match(/\.mp4/g) || []).length);
} catch (e) {
  console.log('gql err', e.message);
}

// extract ALL video-like from stories page more aggressively
const stories = await fetch(`https://www.facebook.com/stories/${PAGE_ID}`, {
  headers: FB_HEADERS,
  redirect: 'follow',
});
const st = normalize(await stories.text());
console.log('\nstories page sample keys', Object.keys(st.match(/"playable[^"]*"/g) || {}).length);
console.log('has video_dash', st.includes('video_dash'), 'has browser_native', st.includes('browser_native'), 'has mp4 raw', st.includes('.mp4'));
// dump any fbcdn video host hits
const hosts = [...new Set([...st.matchAll(/https:\/\/([a-z0-9.-]*fbcdn\.net)/gi)].map((x) => x[1]))];
console.log('fbcdn hosts', hosts.slice(0, 8));
