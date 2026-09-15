const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const USER = 'hail_afgani';

function cookieStr(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function bootstrap() {
  const jar = {};
  const res = await fetch('https://www.instagram.com/', {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  for (const c of typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  // mid is often set via JS; synthesize if missing
  if (!jar.mid) jar.mid = 'Y' + Math.random().toString(36).slice(2, 22).toUpperCase();
  if (!jar.ig_did) jar.ig_did = crypto.randomUUID().toUpperCase();
  return { jar, html, csrf: jar.csrftoken || '' };
}

async function api(jar, csrf, url, extra = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': '936619743392459',
      'X-CSRFToken': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'X-IG-WWW-Claim': '0',
      Referer: 'https://www.instagram.com/',
      Origin: 'https://www.instagram.com',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      Cookie: cookieStr(jar),
      ...extra,
    },
    redirect: 'follow',
  });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type'), text };
}

const { jar, csrf } = await bootstrap();
console.log('cookies', Object.keys(jar), 'csrf', csrf.slice(0, 12));

// update csrf cookie header token
const probes = [
  ['web_profile_info', `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USER}`],
  ['profile_page', `https://www.instagram.com/${USER}/?__a=1&__d=dis`],
  ['profile_html', `https://www.instagram.com/${USER}/`],
];

for (const [name, url] of probes) {
  const r = await api(jar, csrf, url, {
    Accept: name === 'profile_html' ? 'text/html' : '*/*',
  });
  const isJson = r.text.trim().startsWith('{');
  let userId = null;
  let mediaHints = [];
  if (isJson) {
    try {
      const j = JSON.parse(r.text);
      userId = j.data?.user?.id || j.user?.id || j.graphql?.user?.id || null;
    } catch {
      /* ignore */
    }
  } else {
    const m =
      r.text.match(/"user_id"\s*:\s*"?(\d{5,})"?/) ||
      r.text.match(/"id"\s*:\s*"?(\d{5,})"?\s*,\s*"username"\s*:\s*"/) ||
      r.text.match(/profilePage_(\d+)/) ||
      r.text.match(/"pk"\s*:\s*"?(\d{5,})"?/);
    if (m) userId = m[1];
  }
  const mp4 = (r.text.match(/\.mp4/g) || []).length;
  const scontent = (r.text.match(/scontent|cdninstagram/g) || []).length;
  console.log(name, 'status', r.status, 'len', r.text.length, 'userId', userId, 'mp4', mp4, 'scontent', scontent, 'head', r.text.slice(0, 100).replace(/\s+/g, ' '));

  if (userId && name !== 'profile_html') {
    // try story endpoints
    for (const su of [
      `https://i.instagram.com/api/v1/feed/user/${userId}/story/`,
      `https://www.instagram.com/api/v1/feed/user/${userId}/story/`,
      `https://i.instagram.com/api/v1/feed/reels_tray/`,
    ]) {
      const sr = await api(jar, csrf, su, {
        'User-Agent':
          'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)',
      });
      console.log('  story', su.split('/').slice(-2).join('/'), sr.status, sr.text.slice(0, 160).replace(/\s+/g, ' '));
    }
  }
}

// Also try reading user id from public page JSON-LD / meta
const page = await fetch(`https://www.instagram.com/${USER}/`, {
  headers: { 'User-Agent': UA, Accept: 'text/html' },
});
const html = await page.text();
const ids = [...html.matchAll(/"id"\s*:\s*"(\d{8,})"/g)].map((m) => m[1]);
const uniq = [...new Set(ids)].slice(0, 8);
console.log('ids in html', uniq);
const al = html.match(/content="https:\/\/www\.instagram\.com\/([^"]+)"/);
console.log('og', al && al[1]?.slice(0, 80));
