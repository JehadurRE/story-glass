/**
 * Local Node mirror of worker /api/resolve for testing without Cloudflare.
 * Usage: node scripts/local-relay.mjs   → http://127.0.0.1:8787
 */
import http from 'node:http';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const ALLOW_HOST_SUFFIXES = [
  'instagram.com',
  'facebook.com',
  'fbcdn.net',
  'cdninstagram.com',
  'fb.com',
  'fb.watch',
];

function isAllowedTarget(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return ALLOW_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

function normalizeHtml(html) {
  return String(html)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .replace(/\\u003d/gi, '=');
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `u${(h >>> 0).toString(36)}`;
}

function classifyUrl(u) {
  const path = new URL(u).pathname;
  if (/\.mp4(\?|$)/i.test(u) || /\/video\//i.test(path)) return 'video';
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) || /\/photo\//i.test(path)) return 'image';
  return 'unknown';
}

function isCdnish(u) {
  try {
    const host = new URL(u).hostname;
    return /cdninstagram|fbcdn|scontent|instagram\.com|facebook\.com/i.test(host);
  } catch {
    return false;
  }
}

function extractMediaUrls(rawHtml) {
  const html = normalizeHtml(rawHtml);
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8|jpe?g|png|webp)(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/(?:scontent|video|fbcdn|cdninstagram)[^\s"'<>\\]+/gi,
  ];
  for (const re of patterns) {
    for (const m of html.match(re) || []) {
      const clean = m.replace(/[),.;\]}]+$/, '');
      if (isCdnish(clean)) urls.add(clean);
    }
  }

  const named = [];
  const namedRe =
    /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src_no_ratelimit|sd_src_no_ratelimit|hd_src|sd_src|video_url|display_url)"\s*:\s*"([^"]+)"/gi;
  let match;
  while ((match = namedRe.exec(html))) {
    const u = normalizeHtml(match[1]);
    if (u.startsWith('http')) named.push(u);
  }

  const items = [];
  const seen = new Set();
  for (const u of named) {
    if (seen.has(u)) continue;
    seen.add(u);
    items.push({
      type: classifyUrl(u) === 'unknown' ? 'video' : classifyUrl(u),
      url: u,
      id: hashId(u),
      quality: /hd|quality_hd|native_hd/i.test(u) ? 'hd' : 'sd',
      source: 'named-field',
    });
  }
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const type = classifyUrl(u);
    if (type === 'unknown' || /rsrc\.php|\/static\//i.test(u)) continue;
    items.push({ type, url: u, id: hashId(u), source: 'cdn-extract' });
  }
  items.sort((a, b) => {
    const sa = (a.type === 'video' ? 100 : 0) + (a.quality === 'hd' ? 20 : 0) + (a.source === 'named-field' ? 10 : 0);
    const sb = (b.type === 'video' ? 100 : 0) + (b.quality === 'hd' ? 20 : 0) + (b.source === 'named-field' ? 10 : 0);
    return sb - sa;
  });
  return items;
}

function parseTarget(raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean);
  const ig = host.endsWith('instagram.com');
  const fb = host.endsWith('facebook.com') || host.endsWith('fb.com') || host === 'fb.watch';
  if (ig) {
    if (segs[0] === 'stories') return { platform: 'instagram', kind: 'story', username: segs[1], mediaId: segs[2] };
    if (['p', 'reel', 'reels', 'tv'].includes(segs[0])) return { platform: 'instagram', kind: 'post', shortcode: segs[1] };
    if (segs.length === 1) return { platform: 'instagram', kind: 'profile', username: segs[0] };
    return { platform: 'instagram', kind: 'unknown' };
  }
  if (fb) {
    if (segs[0] === 'watch') return { platform: 'facebook', kind: 'video', mediaId: u.searchParams.get('v') };
    if (segs[0] === 'reel' && segs[1]) return { platform: 'facebook', kind: 'video', mediaId: segs[1] };
    if (segs.includes('videos') && /^\d{5,}$/.test(segs[segs.length - 1])) {
      return { platform: 'facebook', kind: 'video', mediaId: segs[segs.length - 1] };
    }
    if (segs[0] === 'stories') return { platform: 'facebook', kind: 'story', pageId: segs[1], mediaId: segs[2] };
    if (segs[0] === 'story.php') {
      return {
        platform: 'facebook',
        kind: 'story',
        storyFbid: u.searchParams.get('story_fbid'),
        pageId: u.searchParams.get('id'),
      };
    }
    if (segs.length >= 1) {
      return { platform: 'facebook', kind: 'profile', username: segs[0] };
    }
    return { platform: 'facebook', kind: 'unknown' };
  }
  return { platform: 'unknown', kind: 'unknown' };
}

const FB_HEADERS = {
  'User-Agent': BROWSER_UA,
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

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      ...FB_HEADERS,
      ...headers,
    },
  });
  return { status: res.status, text: await res.text() };
}

async function resolveFacebook(parsed, originalUrl) {
  const candidates = [];
  if (parsed.kind === 'video' && parsed.mediaId) {
    candidates.push(`https://www.facebook.com/watch/?v=${parsed.mediaId}`);
    if (originalUrl.includes('/videos/')) candidates.push(originalUrl);
    candidates.push(`https://www.facebook.com/reel/${parsed.mediaId}`);
  }
  if (parsed.kind === 'profile' && parsed.username) {
    const h = parsed.username;
    candidates.push(`https://www.facebook.com/${h}/videos`);
    candidates.push(`https://www.facebook.com/${h}/reels`);
    candidates.push(`https://www.facebook.com/${h}`);
  }
  if (!candidates.length) candidates.push(originalUrl);

  for (const url of candidates) {
    try {
      const res = await fetchText(url);
      const items = extractMediaUrls(res.text);
      const videos = items.filter((i) => i.type === 'video' || i.url.includes('.mp4'));
      const usable = videos.length ? videos : items;
      if (usable.length) {
        return {
          ok: true,
          platform: 'facebook',
          items: usable.slice(0, 16).map((i) => ({ ...i, source: 'facebook-html' })),
          source: 'html-extract',
          viaUrl: url,
        };
      }
    } catch {
      /* next */
    }
  }
  return { ok: false, platform: 'facebook', error: 'No Facebook media extracted' };
}

async function resolveInstagram(parsed, originalUrl) {
  const sessionId = process.env.IG_SESSIONID || '';
  if (sessionId && parsed.username) {
    try {
      const page = await fetchText(`https://www.instagram.com/${parsed.username}/`, {
        Cookie: `sessionid=${sessionId}`,
        'X-IG-App-ID': '936619743392459',
      });
      const userId =
        page.text.match(/"user_id"\s*:\s*"?(\d{5,})"?/)?.[1] ||
        page.text.match(/profilePage_(\d+)/)?.[1] ||
        page.text.match(/"pk"\s*:\s*"?(\d{5,})"?/)?.[1];
      if (userId) {
        const story = await fetchText(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
          'User-Agent':
            'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)',
          'X-IG-App-ID': '936619743392459',
          Accept: 'application/json',
          Cookie: `sessionid=${sessionId}`,
        });
        if (story.text.trim().startsWith('{')) {
          const json = JSON.parse(story.text);
          const items = [];
          const push = (media) => {
            if (!media) return;
            if (Array.isArray(media.carousel_media)) return media.carousel_media.forEach(push);
            const videos = media.video_versions || [];
            const images = media.image_versions2?.candidates || [];
            if (videos.length) {
              const best = videos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), videos[0]);
              items.push({
                type: 'video',
                url: best.url,
                username: parsed.username,
                id: String(media.pk || ''),
                source: 'ig-story-api',
              });
            } else if (images.length) {
              const best = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), images[0]);
              items.push({
                type: 'image',
                url: best.url,
                username: parsed.username,
                id: String(media.pk || ''),
                source: 'ig-story-api',
              });
            }
          };
          (json.items || []).forEach(push);
          if (json.reels) Object.values(json.reels).forEach((r) => (r.items || []).forEach(push));
          if (items.length) return { ok: true, platform: 'instagram', items, source: 'ig-story-api', userId };
        }
      }
    } catch (e) {
      /* fall through */
    }
  }
  return {
    ok: false,
    platform: 'instagram',
    error: sessionId
      ? 'IG session set but no stories returned.'
      : 'Instagram requires a logged-in session (login wall) from this datacenter IP.',
    hint: 'Set IG_SESSIONID env for story API, or use Manual paste. Facebook links resolve without login.',
  };
}

async function handleResolve(url) {
  if (!url || !isAllowedTarget(url)) return { ok: false, error: 'Blocked or missing url' };
  const parsed = parseTarget(url);
  if (parsed.platform === 'facebook') return resolveFacebook(parsed, url);
  if (parsed.platform === 'instagram') return resolveInstagram(parsed, url);
  return { ok: false, error: 'Unrecognized URL' };
}

const port = Number(process.env.PORT || 8787);
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (u.pathname === '/health') {
      res.end(
        JSON.stringify({
          ok: true,
          service: 'storyglass-local-relay',
          igSession: Boolean(process.env.IG_SESSIONID),
        })
      );
      return;
    }
    if (u.pathname === '/api/resolve' || u.pathname === '/resolve') {
      const result = await handleResolve(u.searchParams.get('url'));
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'use /api/resolve?url=' }));
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`local relay http://127.0.0.1:${port}/api/resolve?url=`);
  });
