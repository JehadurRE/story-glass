/**
 * URL + payload parsing for Instagram / Facebook story links.
 * Pure functions — no DOM, no network.
 */

export const PLATFORMS = {
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  UNKNOWN: 'unknown',
};

const IG_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);

const FB_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'fb.com',
  'www.fb.com',
  'web.facebook.com',
  'fb.watch',
]);

export function normalizeInput(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^["'<]+|["'>]+$/g, '');
  // common mobile share prefixes
  s = s.replace(/^FB[- ]?IG[- ]?/i, '');
  if (s && !/^https?:\/\//i.test(s)) {
    if (/^(www\.)?(instagram|facebook|fb|instagr)\./i.test(s)) {
      s = 'https://' + s;
    }
  }
  return s;
}

/**
 * @returns {{
 *   platform: string,
 *   kind: 'story'|'post'|'reel'|'profile'|'unknown',
 *   username?: string,
 *   mediaId?: string,
 *   shortcode?: string,
 *   storyFbid?: string,
 *   pageId?: string,
 *   original: string,
 *   normalized: string
 * }}
 */
export function parseUrl(rawInput) {
  const normalized = normalizeInput(rawInput);
  const base = {
    platform: PLATFORMS.UNKNOWN,
    kind: 'unknown',
    original: rawInput || '',
    normalized,
  };

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return base;
  }

  const host = url.hostname.toLowerCase();
  if (IG_HOSTS.has(host)) return parseInstagram(url, base);
  if (FB_HOSTS.has(host)) return parseFacebook(url, base);
  return base;
}

function parseInstagram(url, base) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const result = { ...base, platform: PLATFORMS.INSTAGRAM };

  if (segments[0] === 'stories') {
    result.kind = 'story';
    result.username = segments[1] || undefined;
    result.mediaId = segments[2] || undefined;
    return result;
  }

  if (segments[0] === 'p' || segments[0] === 'reel' || segments[0] === 'reels' || segments[0] === 'tv') {
    result.kind = segments[0] === 'reel' || segments[0] === 'reels' ? 'reel' : 'post';
    result.shortcode = segments[1] || undefined;
    return result;
  }

  if (segments.length === 1 && !['explore', 'accounts', 'about'].includes(segments[0])) {
    result.kind = 'profile';
    result.username = segments[0];
    return result;
  }

  // query ?story_fbid= for some share formats
  const storyFbid = url.searchParams.get('story_fbid');
  if (storyFbid) {
    result.kind = 'story';
    result.mediaId = storyFbid;
    result.username = url.searchParams.get('id') || undefined;
  }

  return result;
}

function parseFacebook(url, base) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const result = { ...base, platform: PLATFORMS.FACEBOOK };

  if (segments[0] === 'stories') {
    result.kind = 'story';
    // /stories/<page_id>/<token>
    result.pageId = segments[1] || undefined;
    result.mediaId = segments[2] || undefined;
    result.username = segments[1] || undefined;
    return result;
  }

  if (segments[0] === 'story.php' || path === '/story.php') {
    result.kind = 'story';
    result.storyFbid = url.searchParams.get('story_fbid') || undefined;
    result.pageId = url.searchParams.get('id') || undefined;
    result.mediaId = result.storyFbid;
    return result;
  }

  if (segments[0] === 'reel' || segments[0] === 'watch') {
    result.kind = 'reel';
    result.mediaId = segments[1] || url.searchParams.get('v') || undefined;
    return result;
  }

  if (segments[0] === 'video.php' || segments[0] === 'video') {
    result.kind = 'post';
    result.mediaId = url.searchParams.get('v') || segments[1] || undefined;
    return result;
  }

  // Page profile: /username or /username/videos
  if (
    segments.length >= 1 &&
    !['share', 'pages', 'groups', 'marketplace', 'events', 'help', 'login', 'watch', 'reel', 'stories'].includes(
      segments[0]
    )
  ) {
    result.kind = 'profile';
    result.username = segments[0];
    return result;
  }

  return result;
}

const CDN_HOST_HINTS = [
  'cdninstagram.com',
  'fbcdn.net',
  'scontent',
  'instagram.com',
  'facebook.com',
];

const VIDEO_EXT = /\.(mp4|m3u8)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

function isCdnish(u) {
  try {
    const h = new URL(u).hostname;
    return CDN_HOST_HINTS.some((x) => h.includes(x));
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeUrl(u) {
  return String(u)
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u0025/g, '%')
    .replace(/\\\//g, '/')
    .replace(/\\x26/gi, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Pull media candidates from arbitrary HTML (FB story page, IG page source).
 */
export function extractMediaFromHtml(html) {
  if (!html || typeof html !== 'string') return [];

  // Normalize JSON-escaped slashes first so one pass can find CDN URLs.
  const normalized = html
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');

  const urls = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8|jpe?g|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/(?:scontent|video|fbcdn|cdninstagram)[^\s"'<>\\]+/gi,
  ];

  for (const re of patterns) {
    const matches = normalized.match(re) || [];
    for (const m of matches) {
      const clean = unescapeUrl(m).replace(/[),.;\]}]+$/, '');
      if (isCdnish(clean)) urls.add(clean);
    }
  }

  return [...urls].map(toMediaItem).filter(Boolean);
}

/**
 * Parse Instagram /api/v1/media/{id}/info/ style JSON.
 */
export function extractMediaFromIgInfo(json) {
  const items = [];
  if (!json) return items;

  const candidates = [];
  if (json.items && Array.isArray(json.items)) candidates.push(...json.items);
  else if (json.item) candidates.push(json.item);
  else if (json.media) candidates.push(json.media);
  else if (json.carousel_media) {
    candidates.push({
      carousel_media: json.carousel_media,
      user: json.user,
      code: json.code,
      pk: json.pk,
      media_type: 8,
    });
  } else if (json.image_versions2 || json.video_versions) {
    candidates.push(json);
  }

  for (const media of candidates) {
    if (!media || typeof media !== 'object') continue;

    if (Array.isArray(media.carousel_media) && media.carousel_media.length) {
      for (const slide of media.carousel_media) {
        const item = igMediaToItem(slide, media);
        if (item) items.push(item);
      }
      continue;
    }

    const item = igMediaToItem(media, media);
    if (item) items.push(item);
  }

  return items;
}

function igMediaToItem(media, parent = {}) {
  const user =
    (media.user && (media.user.username || media.user.full_name)) ||
    (parent.user && parent.user.username) ||
    '';

  const takenAt = media.taken_at || parent.taken_at;
  const caption =
    (media.caption && media.caption.text) ||
    (parent.caption && parent.caption.text) ||
    '';

  const videoVersions = media.video_versions || [];
  const imageCandidates =
    (media.image_versions2 && media.image_versions2.candidates) || [];

  if (videoVersions.length) {
    const best = pickBest(videoVersions, (v) => v.width * v.height);
    return {
      type: 'video',
      url: best.url,
      width: best.width,
      height: best.height,
      username: user,
      caption,
      takenAt,
      id: String(media.pk || media.id || parent.pk || ''),
      source: 'instagram',
    };
  }

  if (imageCandidates.length) {
    const best = pickBest(imageCandidates, (v) => v.width * v.height);
    return {
      type: 'image',
      url: best.url,
      width: best.width,
      height: best.height,
      username: user,
      caption,
      takenAt,
      id: String(media.pk || media.id || parent.pk || ''),
      source: 'instagram',
    };
  }

  return null;
}

function pickBest(list, scoreFn) {
  return list.reduce((a, b) => (scoreFn(b) > scoreFn(a) ? b : a), list[0]);
}

function toMediaItem(rawUrl) {
  const url = unescapeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) return null;
  const isVideo = VIDEO_EXT.test(url) || /\/video\//i.test(url) || /video/i.test(new URL(url).pathname);
  const isImage = IMAGE_EXT.test(url) || /\/photo\//i.test(url);

  let type = 'unknown';
  if (isVideo) type = 'video';
  else if (isImage) type = 'image';
  else if (/\.mp4/i.test(url) || url.includes('video')) type = 'video';
  else type = 'image';

  return {
    type,
    url,
    username: '',
    caption: '',
    takenAt: null,
    id: hashId(url),
    source: 'cdn-extract',
  };
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `u${(h >>> 0).toString(36)}`;
}

/**
 * Detect whether a string looks like JSON vs HTML vs plain text error.
 */
export function detectPayloadKind(text) {
  const t = (text || '').trim();
  if (!t) return 'empty';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      return 'html';
    }
  }
  if (/<html[\s>]|<!doctype html/i.test(t)) return 'html';
  return 'text';
}

export function parseManualPayload(text) {
  const kind = detectPayloadKind(text);
  if (kind === 'json') {
    try {
      const json = JSON.parse(text);
      const items = extractMediaFromIgInfo(json);
      if (items.length) return { items, kind, message: '' };
      // maybe raw object with only URLs
      const fromHtml = extractMediaFromHtml(JSON.stringify(json));
      return { items: fromHtml, kind, message: fromHtml.length ? '' : 'No media found in JSON.' };
    } catch (e) {
      return { items: [], kind, message: 'Invalid JSON: ' + e.message };
    }
  }
  const items = extractMediaFromHtml(text);
  return {
    items,
    kind,
    message: items.length ? '' : 'No CDN media URLs found in pasted content.',
  };
}

export { escapeHtml, unescapeUrl };
