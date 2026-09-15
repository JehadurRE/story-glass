/**
 * Vercel serverless: GET /api/resolve?url=
 * Same contract as worker/cors-relay.js /api/resolve.
 * Facebook HTML extract works without login.
 * Instagram needs process.env.IG_SESSIONID (optional secret).
 *
 * PRIVACY: IG_SESSIONID is a logged-in account; Meta may list it as a story viewer.
 * We never POST Instagram's media/seen endpoint (the explicit "mark viewed" call).
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Full desktop headers — Facebook returns HTTP 400 without Sec-Fetch / ch-ua. */
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

const ANDROID_UA =
  'Instagram 192.0.0.35.78 Android (29/10; 420dpi; 1080x2129; samsung; SM-G973F; beyond1; exynos9820; en_US; 301484484)';

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
    if (['p', 'reel', 'reels', 'tv'].includes(segs[0])) {
      return { platform: 'instagram', kind: 'post', shortcode: segs[1] };
    }
    if (segs.length === 1) return { platform: 'instagram', kind: 'profile', username: segs[0] };
    return { platform: 'instagram', kind: 'unknown' };
  }
  if (fb) {
    if (segs[0] === 'watch') return { platform: 'facebook', kind: 'video', mediaId: u.searchParams.get('v') };
    // /page/videos/123456 or /reel/123456 — not /page/videos (tab)
    if (segs[0] === 'reel' && segs[1]) {
      return { platform: 'facebook', kind: 'video', mediaId: segs[1] };
    }
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
    // Page profile: /username, /username/videos, /username/reels
    if (
      segs.length >= 1 &&
      !['share', 'pages', 'groups', 'marketplace', 'events', 'help', 'login', 'watch'].includes(segs[0])
    ) {
      return { platform: 'facebook', kind: 'profile', username: segs[0], mediaId: null };
    }
    return { platform: 'facebook', kind: 'unknown' };
  }
  return { platform: 'unknown', kind: 'unknown' };
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      ...FB_HEADERS,
      ...headers,
    },
  });
  const text = await res.text();
  return { status: res.status, text };
}

function pageHandleFromUrl(raw) {
  try {
    const u = new URL(raw);
    const segs = u.pathname.split('/').filter(Boolean);
    if (!segs.length) return null;
    const first = segs[0];
    if (
      ['watch', 'reel', 'reels', 'stories', 'story.php', 'video.php', 'share', 'pages', 'groups', 'marketplace', 'events', 'help'].includes(
        first
      )
    ) {
      return null;
    }
    // numeric profile id is ok; username-like handle is ok
    return first;
  } catch {
    return null;
  }
}

function pageMetaFromHtml(html) {
  const title = (html.match(/property="og:title"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:title"/) || [])[1];
  const image = (html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/) || [])[1];
  const desc = (html.match(/property="og:description"\s+content="([^"]+)"/) || [])[1];
  return {
    title: title ? title.replace(/&amp;/g, '&').replace(/&#x27;/g, "'") : '',
    image: image ? image.replace(/&amp;/g, '&') : '',
    description: desc ? desc.replace(/&amp;/g, '&') : '',
  };
}

async function resolveFacebook(parsed, originalUrl) {
  const candidates = [];

  if (parsed.kind === 'video' && parsed.mediaId) {
    candidates.push(`https://www.facebook.com/watch/?v=${parsed.mediaId}`);
    if (originalUrl.includes('/videos/')) candidates.push(originalUrl);
    candidates.push(`https://www.facebook.com/reel/${parsed.mediaId}`);
  }
  if (parsed.kind === 'story') {
    if (parsed.pageId && parsed.mediaId) {
      candidates.push(`https://www.facebook.com/stories/${parsed.pageId}/${parsed.mediaId}`);
    }
    if (parsed.storyFbid) {
      candidates.push(
        `https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(parsed.storyFbid)}${
          parsed.pageId ? `&id=${encodeURIComponent(parsed.pageId)}` : ''
        }`
      );
    }
  }

  // Page / profile: try videos + reels; prefer actual mp4s over thumbnails
  const handle = pageHandleFromUrl(originalUrl);
  if (handle) {
    candidates.push(`https://www.facebook.com/${handle}/reels`);
    candidates.push(`https://www.facebook.com/${handle}/videos`);
    candidates.push(`https://www.facebook.com/${handle}`);
  }

  if (!candidates.length) candidates.push(originalUrl);

  const errors = [];
  let pageMeta = null;
  let imageFallback = null;

  for (const url of candidates) {
    try {
      const res = await fetchText(url);
      if (!pageMeta) {
        const meta = pageMetaFromHtml(res.text);
        if (meta.title) pageMeta = { ...meta, handle };
      }
      const items = extractMediaUrls(res.text);
      const videos = items.filter((i) => i.type === 'video' || i.url.includes('.mp4'));
      if (videos.length) {
        return {
          ok: true,
          platform: 'facebook',
          kind: parsed.kind === 'profile' || !parsed.kind ? 'page' : parsed.kind,
          items: videos.slice(0, 20).map((i) => ({ ...i, source: 'facebook-html' })),
          source: 'html-extract',
          viaUrl: url,
          page: pageMeta,
        };
      }
      if (!imageFallback && items.length) {
        imageFallback = {
          items: items.slice(0, 16).map((i) => ({ ...i, source: 'facebook-html' })),
          viaUrl: url,
        };
      }
      errors.push(`${url} → HTTP ${res.status}, no mp4`);
    } catch (e) {
      errors.push(`${url} → ${e && e.message ? e.message : e}`);
    }
  }

  if (imageFallback) {
    return {
      ok: true,
      platform: 'facebook',
      kind: 'page',
      items: imageFallback.items,
      source: 'html-extract',
      viaUrl: imageFallback.viaUrl,
      page: pageMeta,
      hint: 'Photos only — this page’s public HTML had no progressive videos.',
    };
  }

  if (pageMeta && pageMeta.image) {
    return {
      ok: true,
      platform: 'facebook',
      kind: 'page',
      items: [
        {
          type: 'image',
          url: pageMeta.image,
          id: hashId(pageMeta.image),
          username: handle || '',
          caption: pageMeta.title || '',
          source: 'page-cover',
        },
      ],
      source: 'page-meta',
      page: pageMeta,
      hint: 'Showing page cover. For videos, paste a specific /watch/?v= or /videos/ link.',
    };
  }

  return {
    ok: false,
    platform: 'facebook',
    error: 'Could not extract Facebook media from page HTML.',
    hint: 'Public watch/?v=, /videos/, and page /videos tabs work best with a direct media link.',
    details: errors,
  };
}

function extractFromIgJson(json) {
  const items = [];
  const pushMedia = (media, parent = {}) => {
    if (!media || typeof media !== 'object') return;
    if (Array.isArray(media.carousel_media)) {
      for (const slide of media.carousel_media) pushMedia(slide, media);
      return;
    }
    const user = media.user?.username || parent.user?.username || '';
    const caption = media.caption?.text || parent.caption?.text || '';
    const takenAt = media.taken_at || parent.taken_at || null;
    const id = String(media.pk || media.id || parent.pk || '');
    const videos = media.video_versions || [];
    if (videos.length) {
      const best = videos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), videos[0]);
      items.push({
        type: 'video',
        url: best.url,
        width: best.width,
        height: best.height,
        username: user,
        caption,
        takenAt,
        id,
        source: 'instagram',
      });
      return;
    }
    const images = media.image_versions2?.candidates || [];
    if (images.length) {
      const best = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), images[0]);
      items.push({
        type: 'image',
        url: best.url,
        width: best.width,
        height: best.height,
        username: user,
        caption,
        takenAt,
        id,
        source: 'instagram',
      });
    }
  };
  if (Array.isArray(json.items)) json.items.forEach((m) => pushMedia(m));
  else if (json.item) pushMedia(json.item);
  else if (json.media) pushMedia(json.media);
  if (json.reels) for (const reel of Object.values(json.reels)) (reel.items || []).forEach((i) => pushMedia(i));
  if (json.tray) for (const reel of json.tray) (reel.items || []).forEach((i) => pushMedia(i));
  if (json.story?.items) json.story.items.forEach((i) => pushMedia(i));
  if (json.highlights) for (const h of Object.values(json.highlights)) (h.items || []).forEach((i) => pushMedia(i));
  return items;
}

/** Cookie header from IG_SESSIONID (sessionid=…) or a fuller cookie dump. */
function igCookieHeader() {
  const raw = (process.env.IG_SESSIONID || process.env.IG_COOKIE || '').trim();
  if (!raw) return '';
  if (raw.includes('=') && raw.includes('sessionid')) return raw;
  if (raw.includes(';')) return raw;
  return `sessionid=${raw}`;
}

async function igUserIdFromProfile(username, cookie) {
  // 1) HTML with session — we saw user_id in profile HTML when logged-in
  const page = await fetchText(`https://www.instagram.com/${username}/`, {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html',
    'X-IG-App-ID': '936619743392459',
    Cookie: cookie,
    Referer: 'https://www.instagram.com/',
  });
  const html = page.text;
  for (const re of [
    /"user_id"\s*:\s*"?(\d{5,})"?/,
    /profilePage_(\d+)/,
    /"id"\s*:\s*"(\d{5,})"\s*,\s*"username"/,
    /"pk"\s*:\s*"?(\d{5,})"?/,
  ]) {
    const m = html.match(re);
    if (m && m[1] && m[1].length >= 5) return m[1];
  }

  // 2) web_profile_info (needs real session)
  const info = await fetchText(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      'User-Agent': BROWSER_UA,
      Accept: '*/*',
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
      Referer: `https://www.instagram.com/${username}/`,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    }
  );
  if (info.text.trim().startsWith('{')) {
    try {
      const j = JSON.parse(info.text);
      return j.data?.user?.id || j.user?.id || null;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function fetchIgStoryFeed(userId, cookie) {
  const endpoints = [
    {
      url: `https://i.instagram.com/api/v1/feed/user/${userId}/story/`,
      headers: { 'User-Agent': ANDROID_UA, 'X-IG-App-ID': '936619743392459', Accept: 'application/json', Cookie: cookie },
    },
    {
      url: `https://www.instagram.com/api/v1/feed/user/${userId}/story/`,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookie,
        Referer: 'https://www.instagram.com/',
      },
    },
  ];

  for (const ep of endpoints) {
    // GET only — never POST /api/v1/media/seen/
    const res = await fetchText(ep.url, ep.headers);
    const trimmed = res.text.trim();
    if (!trimmed.startsWith('{')) continue;
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (json.message && /login_required|challenge|wait a few minutes/i.test(String(json.message))) {
      return { items: [], error: json.message, loginWall: true };
    }
    if (json.status === 'fail' && json.message) {
      return { items: [], error: json.message, loginWall: /login/i.test(json.message) };
    }
    const items = extractFromIgJson(json);
    if (items.length) return { items, error: null };
  }
  return { items: [], error: 'Story feed returned no items (no live stories or session blocked).', loginWall: false };
}

function parseSetCookie(res) {
  const jar = {};
  const list =
    typeof res.headers?.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers?.get?.('set-cookie') || '').split(/,\s*(?=[^;]+=[^;]+)/);
  for (const c of list) {
    if (!c) continue;
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const p = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = p.length % 4 === 0 ? '' : '='.repeat(4 - (p.length % 4));
  try {
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(Buffer.from(p + pad, 'base64').toString('utf8'));
    }
    return JSON.parse(atob(p + pad));
  } catch {
    return null;
  }
}

async function resolveViaBraveDown(parsed, originalUrl) {
  let target = originalUrl;
  if (parsed.username) {
    target = `https://www.instagram.com/${parsed.username}/`;
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const pageRes = await fetch('https://bravedown.com/instagram-video-downloader', {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html',
      },
      signal: controller.signal,
    });
    if (!pageRes.ok) {
      return { ok: false, error: `BraveDown initial page HTTP ${pageRes.status}` };
    }
    const html = await pageRes.text();
    const cookies = parseSetCookie(pageRes);
    const snapshots = [...html.matchAll(/wire:snapshot="([^"]+)"/g)]
      .map((m) => {
        try {
          return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const csrf = (html.match(/data-csrf="([^"]+)"/) || [])[1];
    const xsrf = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
    const child = snapshots.find((s) => s.memo?.name === 'public.tool.downloader-public');

    if (!child || !csrf) {
      return { ok: false, error: 'Could not extract BraveDown Livewire snapshot or CSRF token' };
    }

    const cookieHdr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const res = await fetch('https://bravedown.com/livewire/update', {
      method: 'POST',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html, application/xhtml+xml',
        'Content-Type': 'application/json',
        'X-Livewire': 'true',
        'X-CSRF-TOKEN': csrf,
        'X-XSRF-TOKEN': xsrf || csrf,
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://bravedown.com',
        Referer: 'https://bravedown.com/instagram-video-downloader',
        Cookie: cookieHdr,
      },
      body: JSON.stringify({
        _token: csrf,
        components: [
          {
            snapshot: JSON.stringify(child),
            updates: { zlinkz: target },
            calls: [{ path: '', method: 'onDownload', params: [] }],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `BraveDown update HTTP ${res.status}` };
    }

    const json = await res.json();
    const snapJson = json.components?.[0]?.snapshot;
    if (!snapJson) {
      return { ok: false, error: 'No component snapshot returned from BraveDown' };
    }

    const snap = JSON.parse(snapJson);
    const bd = snap.data;

    if (!bd) {
      return { ok: false, error: 'Empty BraveDown payload' };
    }

    if (bd.status === 'error') {
      return { ok: false, error: bd.message || 'BraveDown returned error status' };
    }

    if (bd.status !== 'success' || !Array.isArray(bd.data)) {
      return { ok: false, error: bd.message || 'BraveDown did not return items' };
    }

    const items = [];
    const seenUrls = new Set();
    const username = parsed.username || '';

    for (const entry of bd.data) {
      if (!entry || typeof entry !== 'object') continue;
      const title = entry.title || '';
      const entryUser = title.replace(/^IG Stories\s*-\s*/i, '').trim() || username;
      const thumbnail = entry.thumbnail || null;

      const linkObjects = [];
      const walk = (node) => {
        if (!node) return;
        if (typeof node === 'object') {
          if (node.url && typeof node.url === 'string') linkObjects.push(node);
          if (Array.isArray(node)) node.forEach(walk);
          else Object.values(node).forEach(walk);
        }
      };
      walk(entry.links);

      for (const link of linkObjects) {
        const tokenMatch = link.url.match(/[?&]token=([^&]+)/);
        const jwt = tokenMatch ? decodeJwtPayload(tokenMatch[1]) : null;
        const mediaUrl = jwt?.url || link.url;
        if (!mediaUrl || seenUrls.has(mediaUrl)) continue;
        seenUrls.add(mediaUrl);

        const isVideo =
          link.type === 'video' ||
          link.file === 'mp4' ||
          jwt?.type === 'mp4' ||
          /\.mp4(\?|$)/i.test(mediaUrl);

        items.push({
          type: isVideo ? 'video' : 'image',
          url: mediaUrl,
          downloadUrl: link.url,
          thumbnail,
          username: entryUser,
          caption: title,
          quality: link.quality || (isVideo ? '720p' : 'hd'),
          id: hashId(mediaUrl),
          source: 'bravedown-fallback',
        });
      }
    }

    if (!items.length) {
      return { ok: false, error: 'No media items extracted from BraveDown response' };
    }

    return {
      ok: true,
      platform: 'instagram',
      kind: parsed.kind || 'story',
      items,
      source: 'bravedown-fallback',
      seenMark: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'BraveDown timeout (12s)' : err.message || String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

async function resolveInstagram(parsed, originalUrl) {
  const cookie = igCookieHeader();
  const notes = [];

  // --- session path (same capability class as BraveDown) ---
  if (cookie) {
    try {
      // specific media id
      if (parsed.mediaId) {
        const info = await fetchText(`https://i.instagram.com/api/v1/media/${parsed.mediaId}/info/`, {
          'User-Agent': ANDROID_UA,
          'X-IG-App-ID': '936619743392459',
          Accept: 'application/json',
          Cookie: cookie,
        });
        if (info.text.trim().startsWith('{')) {
          const items = extractFromIgJson(JSON.parse(info.text));
          if (items.length) {
            return {
              ok: true,
              platform: 'instagram',
              kind: parsed.kind,
              items,
              source: 'ig-media-info',
              seenMark: false,
            };
          }
        }
        notes.push('media info: no items');
      }

      const username = parsed.username;
      if (username) {
        const userId = await igUserIdFromProfile(username, cookie);
        if (userId) {
          const feed = await fetchIgStoryFeed(userId, cookie);
          if (feed.items.length) {
            return {
              ok: true,
              platform: 'instagram',
              kind: 'story',
              items: feed.items.map((i) => ({
                ...i,
                username: i.username || username,
                source: 'ig-story-api',
              })),
              source: 'ig-story-api',
              userId,
              seenMark: false,
            };
          }
          notes.push(`story feed: ${feed.error || 'empty'}`);
        } else {
          notes.push('could not resolve user id from profile');
        }
      }
    } catch (e) {
      notes.push(`session path: ${e && e.message ? e.message : e}`);
    }
  }

  // --- logged-out fallbacks (usually login wall in 2026) ---
  if (parsed.mediaId) {
    const info = await fetchText(`https://i.instagram.com/api/v1/media/${parsed.mediaId}/info/`, {
      'User-Agent': ANDROID_UA,
      'X-IG-App-ID': '936619743392459',
      Accept: 'application/json',
    });
    if (info.text.trim().startsWith('{')) {
      const items = extractFromIgJson(JSON.parse(info.text));
      if (items.length) {
        return { ok: true, platform: 'instagram', items, source: 'ig-json-public', seenMark: false };
      }
    }
    notes.push('public media info: login wall or empty');
  }

  if (parsed.shortcode) {
    for (const u of [
      `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`,
      `https://www.instagram.com/reel/${parsed.shortcode}/embed/`,
      `https://www.instagram.com/p/${parsed.shortcode}/`,
    ]) {
      const res = await fetchText(u, { 'User-Agent': BROWSER_UA, Accept: 'text/html' });
      const items = extractMediaUrls(res.text).filter(
        (i) => !/rsrc\.php|static\.cdninstagram\.com$/i.test(i.url)
      );
      if (items.length) {
        return { ok: true, platform: 'instagram', items, source: 'ig-html', seenMark: false };
      }
      notes.push(`${u}: no media`);
    }
  }

  // --- BraveDown automated fallback (scrapes stories without visitor account) ---
  try {
    const bd = await resolveViaBraveDown(parsed, originalUrl);
    if (bd.ok && bd.items?.length) {
      return bd;
    }
    if (bd.error) {
      notes.push(`BraveDown fallback: ${bd.error}`);
    }
  } catch (e) {
    notes.push(`BraveDown fallback error: ${e.message || e}`);
  }

  const bdRateLimit = notes.some((n) => /limit of 10 free downloads|rate limit/i.test(n));

  return {
    ok: false,
    platform: 'instagram',
    error: bdRateLimit
      ? 'Instagram requires login, and the fallback provider (BraveDown) reached its 10 free downloads / 2h limit.'
      : cookie
        ? 'Instagram session did not return media (expired, challenged, or no live stories).'
        : 'Instagram login wall — story APIs need a server session in 2026.',
    hint: bdRateLimit
      ? 'Wait for the 2-hour fallback window to reset, or configure IG_SESSIONID in Vercel for dedicated unlimited access.'
      : cookie
        ? 'Open Vercel → Project → Settings → Environment Variables → update IG_SESSIONID from a fresh throwaway account cookie, then redeploy.'
        : 'Set Vercel env IG_SESSIONID (cookie sessionid from a throwaway IG account). Facebook public videos work without it. Session may appear as a story viewer.',
    seenMark: false,
    details: notes,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const target = req.query.url;
  if (!target || !isAllowedTarget(target)) {
    res.status(400).json({ ok: false, error: 'Missing or blocked url' });
    return;
  }

  try {
    const parsed = parseTarget(target);
    const result =
      parsed.platform === 'facebook'
        ? await resolveFacebook(parsed, target)
        : parsed.platform === 'instagram'
          ? await resolveInstagram(parsed, target)
          : { ok: false, error: 'Unrecognized URL' };
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
