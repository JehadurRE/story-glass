const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// From prior probe of hail_afgani
const USER_ID = '5461443048';
const SESSION = process.env.IG_SESSIONID || '';

if (!SESSION) {
  console.log('Set IG_SESSIONID env to test (browser cookie sessionid=...)');
  process.exit(0);
}

async function story(userId) {
  const res = await fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
    headers: {
      'User-Agent':
        'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)',
      'X-IG-App-ID': '936619743392459',
      Accept: 'application/json',
      Cookie: `sessionid=${SESSION}`,
    },
  });
  const text = await res.text();
  console.log('story status', res.status, text.slice(0, 400));
  return text;
}

async function mediaInfo(id) {
  const res = await fetch(`https://i.instagram.com/api/v1/media/${id}/info/`, {
    headers: {
      'User-Agent':
        'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)',
      'X-IG-App-ID': '936619743392459',
      Accept: 'application/json',
      Cookie: `sessionid=${SESSION}`,
    },
  });
  console.log('media info', res.status, (await res.text()).slice(0, 200));
}

await story(USER_ID);
