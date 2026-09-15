const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalize(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
}

function extractMp4(html) {
  const n = normalize(html);
  return [...new Set((n.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).map((u) => u.replace(/[),.;]+$/, '')))];
}

async function probe(name, url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
      redirect: 'follow',
    });
    const text = await res.text();
    const mp4 = extractMp4(text);
    console.log(
      JSON.stringify({
        name,
        status: res.status,
        len: text.length,
        mp4: mp4.length,
        head: text.slice(0, 80).replace(/\s+/g, ' '),
      })
    );
    return { status: res.status, text, mp4 };
  } catch (e) {
    console.log(JSON.stringify({ name, error: String(e) }));
    return { status: 0, text: '', mp4: [] };
  }
}

// known good
await probe('known-video', 'https://www.facebook.com/facebook/videos/10153231379946729/');
await probe('watch-v', 'https://www.facebook.com/watch/?v=10153231379946729');

// page variants
await probe('page-www', 'https://www.facebook.com/awomensoul');
await probe('page-mbasic', 'https://mbasic.facebook.com/awomensoul');
await probe('page-touch', 'https://touch.facebook.com/awomensoul');
await probe('page-m', 'https://m.facebook.com/awomensoul');
await probe('page-locale', 'https://www.facebook.com/awomensoul/?locale=en_US');
await probe('page-https-www-ua-mobile', 'https://www.facebook.com/awomensoul', {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

// public page by id? try graph without token (won't work) and page source via other mirrors
await probe('page-share', 'https://www.facebook.com/sharer/sharer.php?u=https://www.facebook.com/awomensoul');

// try reels from that page
await probe('page-reels-tab', 'https://www.facebook.com/awomensoul/reels');
await probe('page-videos-tab-mbasic', 'https://mbasic.facebook.com/awomensoul/videos');
