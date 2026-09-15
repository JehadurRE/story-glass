import { proxiedFetch, resolveViaRelay } from '../fetcher.js';
import { extractMediaFromIgInfo, extractMediaFromHtml, detectPayloadKind } from '../parser.js';

/**
 * Resolve Instagram story / post / reel from a parsed URL object.
 * @param {ReturnType<import('../parser.js').parseUrl>} parsed
 * @returns {Promise<{ok: boolean, items: any[], error?: string, hint?: string, via?: string}>}
 */
export async function resolveInstagram(parsed) {
  // 1) Preferred: StoryGlass Worker /api/resolve (can hold IG session)
  const viaRelay = await resolveViaRelay(parsed.normalized || parsed.original);
  if (viaRelay.ok && viaRelay.items?.length) {
    return { ok: true, items: viaRelay.items, via: `relay:${viaRelay.source || 'resolve'}` };
  }

  const { kind, mediaId, shortcode, username } = parsed;

  if (kind === 'story' && mediaId) {
    const direct = await resolveByMediaId(mediaId, username);
    if (direct.ok) return direct;
    // surface relay error if it was more specific
    if (viaRelay.error && viaRelay.error !== 'No relay configured') {
      return { ok: false, items: [], error: viaRelay.error, hint: viaRelay.hint };
    }
    return direct;
  }

  if ((kind === 'post' || kind === 'reel') && shortcode) {
    const byShort = await resolveByShortcode(shortcode);
    if (byShort.ok) return byShort;
    if (viaRelay.error && viaRelay.error !== 'No relay configured') {
      return { ok: false, items: [], error: viaRelay.error, hint: viaRelay.hint };
    }
  }

  if (kind === 'story' && username && !mediaId) {
    return {
      ok: false,
      items: [],
      error:
        viaRelay.error && viaRelay.error !== 'No relay configured'
          ? viaRelay.error
          : `Username-only story links need Instagram's private story API.`,
      hint:
        viaRelay.hint ||
        `Deploy StoryGlass Worker with IG_SESSIONID secret, or paste a specific story link (…/stories/${username}/123…).`,
    };
  }

  if (kind === 'profile') {
    return {
      ok: false,
      items: [],
      error:
        viaRelay.error && viaRelay.error !== 'No relay configured'
          ? viaRelay.error
          : 'Profile links need a server-side Instagram session to list live stories.',
      hint:
        viaRelay.hint ||
        'Set Worker secret IG_SESSIONID (throwaway account), then retry. Or open a single story → Copy link.',
    };
  }

  return {
    ok: false,
    items: [],
    error: 'Unrecognized Instagram link.',
    hint: 'Supported: /stories/<user>/<id>, /p/<code>, /reel/<code>, /<username>/',
  };
}

async function resolveByMediaId(mediaId, username) {
  const endpoints = [
    `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
  ];

  let lastError = '';
  for (const url of endpoints) {
    const res = await proxiedFetch(url, {
      headers: {
        Accept: 'application/json',
        'X-IG-App-ID': '936619743392459',
      },
    });

    if (!res.ok) {
      lastError = res.error || `HTTP ${res.status}`;
      continue;
    }

    const kind = detectPayloadKind(res.text);
    if (kind === 'json') {
      try {
        const json = JSON.parse(res.text);
        const items = extractMediaFromIgInfo(json);
        if (items.length) {
          return { ok: true, items, via: res.via };
        }
        lastError = 'JSON returned but no media candidates.';
      } catch (e) {
        lastError = 'JSON parse error: ' + e.message;
      }
      continue;
    }

    const fromHtml = extractMediaFromHtml(res.text);
    if (fromHtml.length) {
      return { ok: true, items: fromHtml, via: res.via };
    }
    lastError = 'Response had no extractable media (login wall or expired).';
  }

  return {
    ok: false,
    items: [],
    error: lastError || 'Could not resolve Instagram media.',
    hint: username
      ? `Story may be expired, private, or blocked. Try Manual paste with page source from /stories/${username}/${mediaId}`
      : 'Story may be expired or private.',
  };
}

async function resolveByShortcode(shortcode) {
  const url = `https://www.instagram.com/p/${shortcode}/`;
  const res = await proxiedFetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'X-IG-App-ID': '936619743392459',
    },
  });

  if (!res.ok) {
    return { ok: false, items: [], error: res.error || 'Fetch failed' };
  }

  // try additional data JSON embedded in HTML
  const items = extractFromIgHtml(res.text);
  if (items.length) return { ok: true, items, via: res.via };

  return {
    ok: false,
    items: [],
    error: 'No media found on post page (private or blocked).',
  };
}

export function extractFromIgHtml(html) {
  const items = [];

  // /api/v1/media/{id}/info embedded
  const infoMatch = html.match(/"media_id"\s*:\s*"?(\d+)"?/);
  // video_versions / image candidates in additional_data
  const videoUrls = html.match(/https:\\?\/\\?\/[^"]+?\.mp4[^"]*/gi) || [];
  const imageUrls = html.match(/https:\\?\/\\?\/[^"]+?\.(?:jpg|jpeg|webp)[^"]*/gi) || [];

  for (const u of videoUrls) {
    const clean = u.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    items.push({
      type: 'video',
      url: clean,
      id: infoMatch ? infoMatch[1] : '',
      username: '',
      caption: '',
      source: 'html',
    });
  }
  if (!items.length) {
    for (const u of imageUrls) {
      const clean = u.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      if (!clean.includes('profile_pic')) {
        items.push({
          type: 'image',
          url: clean,
          id: infoMatch ? infoMatch[1] : '',
          username: '',
          caption: '',
          source: 'html',
        });
      }
    }
  }

  // additional_data media object
  const additional = html.match(/window\._sharedData\s*=\s*(\{.+?\});/);
  if (additional) {
    try {
      const shared = JSON.parse(additional[1]);
      const edges =
        shared?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
        shared?.entry_data?.PostPage?.[0]?.media;
      if (edges) {
        const more = extractMediaFromIgInfo({ items: [edges], ...edges });
        for (const m of more) if (!items.some((x) => x.url === m.url)) items.push(m);
      }
    } catch {
      /* ignore */
    }
  }

  return items;
}
