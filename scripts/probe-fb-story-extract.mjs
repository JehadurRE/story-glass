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

function decodeStoryId(b64) {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return b64;
  }
}

const res = await fetch('https://www.facebook.com/fpvanik', { headers: FB_HEADERS, redirect: 'follow' });
const html = await res.text();
const n = normalize(html);

// grab a large window around first story_bucket occurrence
const idx = n.indexOf('"story_bucket"');
console.log('story_bucket at', idx);
if (idx < 0) process.exit(0);

// expand to a balanced JSON-ish chunk
const slice = n.slice(idx, idx + 8000);
console.log(slice.slice(0, 2500));
console.log('---');

// decode first_story id
const first = slice.match(/"first_story_to_show":\{"id":"([^"]+)"/);
if (first) {
  console.log('first_story id raw', first[1]);
  console.log('first_story decoded', decodeStoryId(first[1]));
}

// find any media in the slice
const mp4 = [...new Set((slice.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []))];
const jpg = [...new Set((slice.match(/https?:\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg|webp)[^\s"'<>\\]*/gi) || []))]
  .filter((u) => /fbcdn|scontent/i.test(u) && !/safe_image|profile_pic/i.test(u));
console.log('mp4 in slice', mp4.length, mp4[0]?.slice(0, 100));
console.log('jpg in slice', jpg.length, jpg[0]?.slice(0, 100));

// search whole page for video IDs near story
const allMp4 = [...new Set((n.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []))];
console.log('all mp4 on page', allMp4.length);

// try opening story viewer with decoded id
const sid = first ? decodeStoryId(first[1]) : null;
if (sid) {
  // UzpfSTI6... format → STI:1391279903214514 → numeric
  const numeric = sid.replace(/^.*:/, '');
  console.log('numeric story id', numeric);
  for (const url of [
    `https://www.facebook.com/stories/2018396421522448/${numeric}`,
    `https://www.facebook.com/story.php?story_fbid=${numeric}&id=2018396421522448`,
    `https://www.facebook.com/story.php?story_fbid=${numeric}&id=100011212938633`,
  ]) {
    const r = await fetch(url, { headers: FB_HEADERS, redirect: 'follow' });
    const t = normalize(await r.text());
    const m4 = [...new Set((t.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi) || []))];
    const named = [];
    const re =
      /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src)"\s*:\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(t))) named.push(normalize(m[1]));
    console.log(
      JSON.stringify({
        path: url.replace('https://www.facebook.com', ''),
        status: r.status,
        len: t.length,
        mp4: m4.length,
        named: named.length,
      })
    );
    if (m4[0]) console.log(' ', m4[0].slice(0, 120));
    if (named[0]) console.log(' N', named[0].slice(0, 120));
  }
}
