const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

const res = await fetch('https://www.facebook.com/awomensoul/videos', { headers, redirect: 'follow' });
const text = await res.text();
const n = normalize(text);
const mp4 = [
  ...new Set(
    (n.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []).map((u) => u.replace(/[),.;]+$/, ''))
  ),
];
console.log('count', mp4.length);
mp4.slice(0, 8).forEach((u) => console.log(u.slice(0, 160)));

// named fields
const named = [];
const re =
  /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src)"\s*:\s*"([^"]+)"/gi;
let m;
while ((m = re.exec(n))) named.push(normalize(m[1]).slice(0, 120));
console.log('named', named.length);
named.slice(0, 5).forEach((u) => console.log('N', u));
