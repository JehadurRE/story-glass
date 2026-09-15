const tests = [];

async function tryFetch(name, url, headers) {
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    const text = await res.text();
    tests.push({
      name,
      status: res.status,
      type: res.headers.get('content-type'),
      len: text.length,
      head: text.slice(0, 180).replace(/\s+/g, ' '),
      isJson: text.trim().startsWith('{') || text.trim().startsWith('['),
      hasMp4: text.includes('.mp4'),
    });
  } catch (e) {
    tests.push({ name, error: String(e) });
  }
}

const ANDROID =
  'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)';
const IOS =
  'Instagram 219.0.0.12.117 (iPhone13,3; iOS 14_6; en_US; en-US; scale=3.00; 1170x2532; 332280746) AppleWebKit/420+';

await tryFetch('i.api media info', 'https://i.instagram.com/api/v1/media/3390000000000000000/info/', {
  'User-Agent': ANDROID,
  'X-IG-App-ID': '936619743392459',
  'X-IG-Capabilities': '3brTvw==',
  Accept: 'application/json',
});

await tryFetch('i.api user story', 'https://i.instagram.com/api/v1/feed/user/2207622239/story/', {
  'User-Agent': ANDROID,
  'X-IG-App-ID': '936619743392459',
  Accept: 'application/json',
});

await tryFetch('www api user info', 'https://www.instagram.com/api/v1/users/web_profile_info/?username=nasa', {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  Accept: '*/*',
});

await tryFetch('www api media by shortcode', 'https://www.instagram.com/api/v1/media/shortcode/B8ZRKU4B4Lq/info/', {
  'User-Agent': IOS,
  'X-IG-App-ID': '936619743392459',
  Accept: 'application/json',
});

// oembed variants
await tryFetch('oembed v1', 'https://api.instagram.com/oembed/?url=https://www.instagram.com/p/B8ZRKU4B4Lq/', {
  Accept: 'application/json',
});

await tryFetch('graph oembed', 'https://graph.facebook.com/v19.0/instagram_oembed?url=https://www.instagram.com/p/B8ZRKU4B4Lq/&fields=thumbnail_url,html', {
  Accept: 'application/json',
});

console.log(JSON.stringify(tests, null, 2));
