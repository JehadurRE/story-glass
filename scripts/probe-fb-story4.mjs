const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PAGE_ID = '2018396421522448';
const STORY_ID = '1391279903214514';

const headersList = [
  {
    name: 'desktop-full',
    h: {
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
    },
  },
  {
    name: 'mobile-safari',
    h: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
  {
    name: 'mbasic',
    h: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36',
      Accept: 'text/html',
    },
  },
];

const urls = [
  `https://www.facebook.com/stories/${PAGE_ID}/${STORY_ID}`,
  `https://www.facebook.com/stories/${PAGE_ID}/${STORY_ID}/?__a=1&__d=dis`,
  `https://m.facebook.com/stories.php?story_fbid=${STORY_ID}&id=${PAGE_ID}`,
  `https://mbasic.facebook.com/stories.php?story_fbid=${STORY_ID}&id=${PAGE_ID}`,
  `https://www.facebook.com/story.php?story_fbid=${STORY_ID}&id=${PAGE_ID}`,
  `https://touch.facebook.com/stories/${PAGE_ID}/${STORY_ID}`,
];

for (const { name, h } of headersList) {
  for (const url of urls.slice(0, name === 'mbasic' ? 6 : 3)) {
    try {
      const res = await fetch(url, { headers: h, redirect: 'follow' });
      const text = await res.text();
      const n = text.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
      const mp4 = (n.match(/\.mp4/g) || []).length;
      const named = (n.match(/browser_native|playable_url|hd_src/g) || []).length;
      console.log(
        JSON.stringify({
          ua: name,
          path: url.replace(/https:\/\/(www|m|mbasic|touch)\.facebook\.com/, ''),
          status: res.status,
          len: text.length,
          mp4,
          named,
          title: (text.match(/<title[^>]*>([^<]{0,40})/i) || [])[1],
        })
      );
    } catch (e) {
      console.log(name, e.message);
    }
  }
}
