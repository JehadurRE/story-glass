import { proxiedFetch, resolveViaRelay, resolveFacebookViaProxies } from '../fetcher.js';
import { extractMediaFromHtml, detectPayloadKind, extractMediaFromIgInfo } from '../parser.js';

/**
 * Resolve Facebook story / reel / video links.
 * Order: Worker relay → proxy HTML extract → direct page fetch.
 */
export async function resolveFacebook(parsed) {
  const target = parsed.normalized || parsed.original;

  // 1) Worker /api/resolve — proven path for public watch/videos links
  const viaRelay = await resolveViaRelay(target);
  if (viaRelay.ok && viaRelay.items?.length) {
    return {
      ok: true,
      items: viaRelay.items,
      via: `relay:${viaRelay.source || 'resolve'}`,
      page: viaRelay.page || null,
    };
  }

  // 2) Client-side HTML mine through public CORS proxies
  const probeUrls = buildCandidateUrls(parsed);
  for (const pageUrl of probeUrls) {
    const viaProxy = await resolveFacebookViaProxies(pageUrl);
    if (viaProxy.ok && viaProxy.items?.length) {
      return { ok: true, items: viaProxy.items, via: `proxy:${viaProxy.source}` };
    }
  }

  // 3) Direct fetch (usually CORS-blocked in browser; still try)
  const { kind, mediaId, pageId, storyFbid, username } = parsed;
  const candidateUrls = probeUrls;

  if (!candidateUrls.length) {
    return {
      ok: false,
      items: [],
      error: viaRelay.error && viaRelay.error !== 'No relay configured' ? viaRelay.error : 'Unrecognized Facebook link.',
      hint: 'Use a story URL like facebook.com/stories/<page>/<token> or watch/?v=…',
    };
  }

  let lastError = viaRelay.error && viaRelay.error !== 'No relay configured' ? viaRelay.error : '';
  for (const url of candidateUrls) {
    const res = await proxiedFetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      lastError = res.error || `HTTP ${res.status}`;
      continue;
    }

    const kindDetected = detectPayloadKind(res.text);
    let items = [];

    if (kindDetected === 'json') {
      try {
        items = extractMediaFromIgInfo(JSON.parse(res.text));
      } catch {
        items = [];
      }
    }

    if (!items.length) {
      items = extractFacebookMedia(res.text);
    }

    if (items.length) {
      return {
        ok: true,
        items: items.map((i) => ({
          ...i,
          username: i.username || username || pageId || '',
          source: 'facebook',
        })),
        via: res.via,
      };
    }

    lastError = 'Page fetched but no media URLs found (login wall, expired, or private).';
  }

  return {
    ok: false,
    items: [],
    error: lastError || 'Could not resolve Facebook media.',
    hint:
      viaRelay.hint ||
      (storyFbid
        ? 'Open the story in a logged-out browser if possible, View Source, then Manual paste.'
        : 'Public watch/?v= and /videos/ links work best. Expired stories disappear after ~24h.'),
  };
}

function buildCandidateUrls(parsed) {
  const { kind, mediaId, pageId, storyFbid, username, normalized, original } = parsed;
  const candidates = [];

  if ((kind === 'video' || kind === 'reel') && mediaId) {
    candidates.push(`https://www.facebook.com/watch/?v=${mediaId}`);
    if ((normalized || original || '').includes('/videos/')) candidates.push(normalized || original);
    candidates.push(`https://www.facebook.com/reel/${mediaId}`);
  }
  if (kind === 'story') {
    if (pageId && mediaId) candidates.push(`https://www.facebook.com/stories/${pageId}/${mediaId}/`);
    if (storyFbid && pageId) {
      candidates.push(
        `https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(storyFbid)}&id=${encodeURIComponent(pageId)}`
      );
    }
    if (mediaId && !pageId) {
      candidates.push(`https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(mediaId)}`);
    }
  }
  if (kind === 'profile' && username) {
    candidates.push(`https://www.facebook.com/${username}/videos`);
    candidates.push(`https://www.facebook.com/${username}/reels`);
    candidates.push(`https://www.facebook.com/${username}`);
  }
  if (!candidates.length && (normalized || original)) candidates.push(normalized || original);
  return candidates;
}

/**
 * Prefer playable progressive MP4s over HLS when both exist.
 */
export function extractFacebookMedia(html) {
  const raw = extractMediaFromHtml(html);
  if (!raw.length) return [];

  // Facebook often embeds playable URLs with &amp; and extra query junk
  const cleaned = raw.map((item) => ({
    ...item,
    url: item.url.replace(/&amp;/g, '&'),
  }));

  // de-dupe by path without query
  const seen = new Set();
  const unique = [];
  for (const item of cleaned) {
    let key;
    try {
      const u = new URL(item.url);
      key = u.origin + u.pathname;
    } catch {
      key = item.url;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  // prefer mp4
  unique.sort((a, b) => {
    const av = a.type === 'video' || a.url.includes('.mp4') ? 0 : 1;
    const bv = b.type === 'video' || b.url.includes('.mp4') ? 0 : 1;
    return av - bv;
  });

  return unique.map((item) => {
    if (item.url.includes('.mp4')) return { ...item, type: 'video' };
    if (/\.(jpe?g|png|webp)/i.test(item.url)) return { ...item, type: 'image' };
    return item;
  });
}
