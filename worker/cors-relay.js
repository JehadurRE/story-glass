/**
 * StoryGlass CORS relay + media resolver (Cloudflare Worker).
 *
 * Routes:
 *   GET  /health
 *   GET  /fetch?url=           generic text proxy (CORS)
 *   GET  /api/resolve?url=     platform-aware media resolve → JSON items
 *
 * Deploy:
 *   wrangler deploy worker/cors-relay.js --name storyglass-relay
 *
 * Optional Instagram session (for public profile stories — same idea as
 * commercial downloaders holding a server-side account):
 *   wrangler secret put IG_SESSIONID
 *   value = sessionid cookie from a throwaway IG account
 *
 * PRIVACY: IG_SESSIONID is a real logged-in account. When this Worker calls
 * feed/user/{id}/story/, Instagram may list that account as a STORY VIEWER
 * on the creator’s insights. It does NOT make the end user anonymous.
 * Do not market this as an anonymous/stealth story viewer.
 *
 * Without IG_SESSIONID, Instagram resolve returns a clear login-wall error;
 * Facebook public videos still work. Visitors never create StoryGlass accounts.
 */

const ALLOWED_ORIGINS = ['*'];

const ALLOW_HOST_SUFFIXES = [
  'instagram.com',
  'facebook.com',
  'fbcdn.net',
  'cdninstagram.com',
  'fb.com',
  'fb.watch',
];

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0] || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-IG-App-ID, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isAllowedTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOW_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
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
  if (/\.m3u8(\?|$)/i.test(u)) return 'video';
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

  // Named FB fields often hold the best progressive URLs
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
    if (type === 'unknown') continue;
    // skip tiny sprites / static
    if (/rsrc\.php|\/static\//i.test(u)) continue;
    items.push({
      type,
      url: u,
      id: hashId(u),
      source: 'cdn-extract',
    });
  }

  // prefer video mp4, then image
  items.sort((a, b) => score(b) - score(a));
  return items;
}

function score(item) {
  let s = 0;
  if (item.type === 'video') s += 100;
  if (item.quality === 'hd') s += 20;
  if (item.source === 'named-field') s += 10;
  if (item.url.includes('.mp4')) s += 5;
  return s;
}

function parseTarget(raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean);
  const ig = host.endsWith('instagram.com') || host.endsWith('instagr.am');
  const fb = host.endsWith('facebook.com') || host.endsWith('fb.com') || host === 'fb.watch';

  if (ig) {
    if (segs[0] === 'stories') {
      return { platform: 'instagram', kind: 'story', username: segs[1], mediaId: segs[2] };
    }
    if (['p', 'reel', 'reels', 'tv'].includes(segs[0])) {
      return { platform: 'instagram', kind: 'post', shortcode: segs[1] };
    }
    if (segs.length === 1) return { platform: 'instagram', kind: 'profile', username: segs[0] };
    return { platform: 'instagram', kind: 'unknown' };
  }

  if (fb) {
    if (segs[0] === 'stories') {
      return { platform: 'facebook', kind: 'story', pageId: segs[1], mediaId: segs[2] };
    }
    if (segs[0] === 'story.php') {
      return {
        platform: 'facebook',
        kind: 'story',
        storyFbid: u.searchParams.get('story_fbid'),
        pageId: u.searchParams.get('id'),
      };
    }
    if (segs[0] === 'reel' && segs[1]) {
      return { platform: 'facebook', kind: 'video', mediaId: segs[1] };
    }
    if (segs.includes('videos') && /^\d{5,}$/.test(segs[segs.length - 1])) {
      return { platform: 'facebook', kind: 'video', mediaId: segs[segs.length - 1] };
    }
    if (segs[0] === 'watch') {
      return { platform: 'facebook', kind: 'video', mediaId: u.searchParams.get('v') };
    }
    if (segs[0] === 'share') {
      return { platform: 'facebook', kind: 'share', mediaId: segs.slice(1).join('/') };
    }
    // page profile /username or /username/videos
    if (segs.length >= 1) {
      return { platform: 'facebook', kind: 'profile', username: segs[0] };
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
  return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
}

async function resolveFacebook(parsed, originalUrl) {
  const candidates = [];

  if (parsed.kind === 'video' && parsed.mediaId) {
    candidates.push(`https://www.facebook.com/watch/?v=${parsed.mediaId}`);
    candidates.push(`https://www.facebook.com/${parsed.mediaId.includes('/') ? parsed.mediaId : `video.php?v=${parsed.mediaId}`}`);
    candidates.push(`https://www.facebook.com/reel/${parsed.mediaId}`);
    if (originalUrl.includes('/videos/')) candidates.push(originalUrl);
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
  if (parsed.kind === 'share') {
    candidates.push(originalUrl);
    candidates.push(`https://www.facebook.com/share/${parsed.mediaId}`);
  }
  if (parsed.kind === 'profile' && parsed.username) {
    const h = parsed.username;
    candidates.push(`https://www.facebook.com/${h}/videos`);
    candidates.push(`https://www.facebook.com/${h}/reels`);
    candidates.push(`https://www.facebook.com/${h}`);
  }
  if (!candidates.length) candidates.push(originalUrl);

  const errors = [];
  for (const url of candidates) {
    try {
      const res = await fetchText(url);
      if (res.status >= 500) {
        errors.push(`${url} → HTTP ${res.status}`);
        continue;
      }
      const items = extractMediaUrls(res.text);
      const videos = items.filter((i) => i.type === 'video' || i.url.includes('.mp4'));
      const usable = videos.length ? videos : items;
      if (usable.length) {
        return {
          ok: true,
          platform: 'facebook',
          kind: parsed.kind === 'profile' ? 'page' : parsed.kind,
          items: usable.slice(0, 16).map((i) => ({
            ...i,
            username: parsed.username || parsed.pageId || '',
            source: 'facebook-html',
          })),
          source: 'html-extract',
          viaUrl: url,
        };
      }
      errors.push(`${url} → no media in HTML`);
    } catch (e) {
      errors.push(`${url} → ${e && e.message ? e.message : e}`);
    }
  }

  return {
    ok: false,
    platform: 'facebook',
    error: 'Could not extract Facebook media from page HTML.',
    hint: 'Story may be private, expired, or login-walled. Watch/reel public videos usually work.',
    details: errors,
  };
}

async function igUserIdFromProfile(username, headers = {}) {
  const res = await fetchText(`https://www.instagram.com/${username}/`, {
    'X-IG-App-ID': '936619743392459',
    ...headers,
  });
  const html = res.text;
  const patterns = [
    /"user_id"\s*:\s*"?(\d{5,})"?/,
    /"id"\s*:\s*"(\d{5,})"\s*,\s*"username"\s*:\s*"/,
    /profilePage_(\d+)/,
    /"profile_id"\s*:\s*"?(\d{5,})"?/,
    /"pk"\s*:\s*"?(\d{5,})"?/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].length >= 5) return m[1];
  }
  return null;
}

async function resolveInstagramWithSession(parsed, originalUrl, sessionId) {
  const cookie = `sessionid=${sessionId}`;
  const androidHeaders = {
    'User-Agent': ANDROID_UA,
    'X-IG-App-ID': '936619743392459',
    Accept: 'application/json',
    Cookie: cookie,
  };

  // Story by username (profile link or stories/user/id)
  const username = parsed.username;
  if (username) {
    try {
      const userId = await igUserIdFromProfile(username, { Cookie: cookie });
      if (userId) {
        const storyRes = await fetchText(
          `https://i.instagram.com/api/v1/feed/user/${userId}/story/`,
          androidHeaders
        );
        if (storyRes.text.trim().startsWith('{')) {
          const storyJson = JSON.parse(storyRes.text);
          const items = extractFromIgJson(storyJson).map((i) => ({
            ...i,
            username: i.username || username,
            source: 'ig-story-api',
          }));
          if (items.length) {
            return {
              ok: true,
              platform: 'instagram',
              kind: 'story',
              items,
              source: 'ig-story-api',
              userId,
            };
          }
          if (storyJson.message && /login|wait|challenge/i.test(storyJson.message)) {
            return {
              ok: false,
              platform: 'instagram',
              error: 'Instagram session rejected: ' + storyJson.message,
              hint: 'Refresh IG_SESSIONID secret — session may be expired or challenged.',
            };
          }
        }
      }
    } catch (e) {
      // fall through to logged-out attempts
    }
  }

  // media id
  if (parsed.mediaId) {
    try {
      const info = await fetchText(
        `https://i.instagram.com/api/v1/media/${parsed.mediaId}/info/`,
        androidHeaders
      );
      if (info.text.trim().startsWith('{')) {
        const items = extractFromIgJson(JSON.parse(info.text));
        if (items.length) {
          return { ok: true, platform: 'instagram', kind: parsed.kind, items, source: 'ig-media-info' };
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ok: false,
    platform: 'instagram',
    error: 'Session present but no media returned for this link.',
    hint: 'Profile may have no live stories, or the media id is expired/private.',
  };
}

async function resolveInstagram(parsed, originalUrl, igSessionId) {
  if (igSessionId) {
    const withSession = await resolveInstagramWithSession(parsed, originalUrl, igSessionId);
    if (withSession.ok) return withSession;
    // fall through to logged-out attempts if session path failed
  }

  const attempts = [];

  // 1) media info (needs session in practice; still try)
  if (parsed.mediaId) {
    attempts.push({
      url: `https://i.instagram.com/api/v1/media/${parsed.mediaId}/info/`,
      headers: { 'User-Agent': ANDROID_UA, 'X-IG-App-ID': '936619743392459', Accept: 'application/json' },
      kind: 'json',
    });
    attempts.push({
      url: `https://www.instagram.com/api/v1/media/${parsed.mediaId}/info/`,
      headers: { 'X-IG-App-ID': '936619743392459', Accept: 'application/json' },
      kind: 'json',
    });
  }

  // 2) embed + post HTML (rarely has media logged-out, but cheap)
  if (parsed.shortcode) {
    attempts.push({ url: `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`, kind: 'html' });
    attempts.push({ url: `https://www.instagram.com/reel/${parsed.shortcode}/embed/`, kind: 'html' });
    attempts.push({ url: `https://www.instagram.com/p/${parsed.shortcode}/`, kind: 'html' });
  }
  if (parsed.kind === 'story' && parsed.username && parsed.mediaId) {
    attempts.push({
      url: `https://www.instagram.com/stories/${parsed.username}/${parsed.mediaId}/`,
      kind: 'html',
    });
  }
  if (parsed.kind === 'profile' && parsed.username) {
    attempts.push({
      url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(parsed.username)}`,
      headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', Accept: '*/*' },
      kind: 'json',
    });
    attempts.push({ url: `https://www.instagram.com/${parsed.username}/`, kind: 'html' });
  }
  if (!attempts.length) attempts.push({ url: originalUrl, kind: 'html' });

  const notes = [];
  for (const attempt of attempts) {
    try {
      const res = await fetchText(attempt.url, attempt.headers || {});
      if (attempt.kind === 'json') {
        const trimmed = res.text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          let jsonBody;
          try {
            jsonBody = JSON.parse(trimmed);
          } catch {
            notes.push(`${attempt.url} → bad JSON`);
            continue;
          }
          const items = extractFromIgJson(jsonBody);
          if (items.length) {
            return {
              ok: true,
              platform: 'instagram',
              kind: parsed.kind,
              items,
              source: 'ig-json',
              viaUrl: attempt.url,
            };
          }
          if (jsonBody.message && /login_required/i.test(jsonBody.message + (jsonBody.error_title || ''))) {
            notes.push(`${attempt.url} → login_required`);
            continue;
          }
          notes.push(`${attempt.url} → JSON without media`);
          continue;
        }
        // HTML instead of JSON (login wall shell)
        const items = extractMediaUrls(res.text).filter((i) => !/rsrc\.php/i.test(i.url));
        const real = items.filter((i) => !/static\.cdninstagram\.com$/i.test(i.url));
        if (real.length) {
          return {
            ok: true,
            platform: 'instagram',
            kind: parsed.kind,
            items: real,
            source: 'ig-html',
            viaUrl: attempt.url,
          };
        }
        notes.push(`${attempt.url} → HTML shell (login wall)`);
        continue;
      }

      const items = extractMediaUrls(res.text).filter(
        (i) => !/rsrc\.php|static\.cdninstagram\.com$/i.test(i.url)
      );
      if (items.length) {
        return {
          ok: true,
          platform: 'instagram',
          kind: parsed.kind,
          items,
          source: 'ig-html',
          viaUrl: attempt.url,
        };
      }
      notes.push(`${attempt.url} → no extractable media`);
    } catch (e) {
      notes.push(`${attempt.url} → ${e && e.message ? e.message : e}`);
    }
  }

  // --- BraveDown automated fallback ---
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
      : igSessionId
        ? 'Instagram still returned a login wall (session may be expired or challenged).'
        : 'Instagram requires a logged-in session for most public media in 2026.',
    hint: bdRateLimit
      ? 'Wait for the 2-hour fallback window to reset, or set Worker secret IG_SESSIONID for dedicated unlimited access.'
      : igSessionId
        ? 'Rotate IG_SESSIONID wrangler secret from a fresh throwaway account cookie.'
        : 'Set Worker secret IG_SESSIONID (sessionid cookie) for profile stories, or use Manual paste. Facebook public videos work without a session.',
    details: notes,
  };
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
    if (!pageRes.ok) return { ok: false, error: `BraveDown initial page HTTP ${pageRes.status}` };

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

    if (!child || !csrf) return { ok: false, error: 'Could not extract BraveDown Livewire snapshot or CSRF token' };

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

    if (!res.ok) return { ok: false, error: `BraveDown update HTTP ${res.status}` };

    const json = await res.json();
    const snapJson = json.components?.[0]?.snapshot;
    if (!snapJson) return { ok: false, error: 'No component snapshot returned from BraveDown' };

    const snap = JSON.parse(snapJson);
    const bd = snap.data;
    if (!bd) return { ok: false, error: 'Empty BraveDown payload' };
    if (bd.status === 'error') return { ok: false, error: bd.message || 'BraveDown returned error status' };
    if (bd.status !== 'success' || !Array.isArray(bd.data)) return { ok: false, error: bd.message || 'BraveDown did not return items' };

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

    if (!items.length) return { ok: false, error: 'No media items extracted from BraveDown response' };

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
  else if (json.data?.user?.edge_owner_to_timeline_media?.edges) {
    for (const e of json.data.user.edge_owner_to_timeline_media.edges) pushMedia(e.node);
  }
  // story tray
  if (json.reels) {
    for (const reel of Object.values(json.reels)) {
      for (const item of reel.items || []) pushMedia(item);
    }
  }
  if (json.tray) {
    for (const reel of json.tray) {
      for (const item of reel.items || []) pushMedia(item);
    }
  }
  return items;
}

async function handleResolve(url, requestOrigin, env) {
  if (!url) return json({ ok: false, error: 'Missing url parameter' }, 400, requestOrigin);
  if (!isAllowedTarget(url)) {
    return json(
      { ok: false, error: 'Only facebook.com / instagram.com (and their CDNs) are allowed.' },
      400,
      requestOrigin
    );
  }

  const igSessionId = (env && env.IG_SESSIONID) || '';
  const parsed = parseTarget(url);
  if (parsed.platform === 'facebook') {
    return json(await resolveFacebook(parsed, url), 200, requestOrigin);
  }
  if (parsed.platform === 'instagram') {
    return json(await resolveInstagram(parsed, url, igSessionId), 200, requestOrigin);
  }
  return json({ ok: false, error: 'Unrecognized URL' }, 400, requestOrigin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'storyglass-relay',
          routes: ['/fetch?url=', '/api/resolve?url='],
          igSession: Boolean(env && env.IG_SESSIONID),
          time: new Date().toISOString(),
        },
        200,
        origin
      );
    }

    if (url.pathname === '/api/resolve' || url.pathname === '/resolve') {
      try {
        return await handleResolve(url.searchParams.get('url'), origin, env);
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500, origin);
      }
    }

    if (url.pathname === '/fetch') {
      const target = url.searchParams.get('url');
      if (!target || !isAllowedTarget(target)) {
        return json({ error: 'Blocked or missing target URL' }, 400, origin);
      }
      try {
        const upstream = await fetch(target, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: request.headers.get('Accept') || '*/*',
            'X-IG-App-ID': '936619743392459',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      } catch (e) {
        return json({ error: String(e && e.message ? e.message : e) }, 502, origin);
      }
    }

    return json({ error: 'Not found. Use /api/resolve?url= or /fetch?url=' }, 404, origin);
  },
};
