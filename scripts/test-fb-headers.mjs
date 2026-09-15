const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Cache-Control': 'max-age=0',
};

for (const url of [
  'https://www.facebook.com/awomensoul',
  'https://www.facebook.com/awomensoul/videos',
  'https://www.facebook.com/facebook/videos/10153231379946729/',
]) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  const mp4 = (text.match(/\.mp4/g) || []).length;
  console.log(res.status, text.length, 'mp4hits', mp4, url, (text.match(/<title[^>]*>([^<]+)/i) || [])[1]);
}
