# StoryGlass

Client-first **Facebook + Instagram story viewer**. Paste a public story link, watch segments in the browser. **No visitor accounts.** Optional personal CORS relay.

Inspired by products like BraveDown’s story tools, but scoped to two platforms and a static architecture.

---

## Quick start

```powershell
cd story-glass

# 1) local resolve relay (required for real Facebook media)
node scripts\local-relay.mjs
# → http://127.0.0.1:8787

# 2) static app
node scripts\dev-server.mjs
# → http://127.0.0.1:4173
```

Open `http://127.0.0.1:4173` → **Relay settings** → base URL `http://127.0.0.1:8787` → Save.

Click **Load demo** to preview the story rail without Meta.

### Instagram session is NOT anonymous

`IG_SESSIONID` is a **logged-in Instagram account on your Worker**. When it calls
`i.instagram.com/api/v1/feed/user/{id}/story/`, Instagram often records **that account as a viewer**
of the story (visible to the creator). 

| Goal | Reality |
|------|---------|
| Visitor has no StoryGlass account | Yes |
| Creator cannot tell anyone viewed | **No**, if you use `IG_SESSIONID` |
| CDN file open after URL is known | Usually no extra view mark |
| True stealth story viewing | Not something this (or BraveDown-style tools) can honestly promise |

If you need low attribution, do not enable `IG_SESSIONID`. Use Facebook public links or Manual paste.

### Verified live (2026-09-15)

| Link | Result |
|------|--------|
| `facebook.com/facebook/videos/10153231379946729/` | **4 progressive mp4s** via `/api/resolve` |
| `instagram.com/hail_afgani/` | Stories exist (BraveDown returned jpg). Ours needs `IG_SESSIONID` |
| IG post/reel shortcodes | Login wall from datacenter IPs |

---

## Deploy the optional Worker

```powershell
npx wrangler deploy worker/cors-relay.js --name storyglass-relay
npx wrangler secret put IG_SESSIONID   # optional: throwaway IG sessionid cookie
```

In the app: **Relay settings** → `https://storyglass-relay.<account>.workers.dev` → Save.

`GET /health` returns `{ igSession: true }` when the secret is set.

Worker only GETs facebook/instagram hosts and returns JSON media URLs — it does not host files.


---

## Features

- Instagram story / post / reel URL parsing
- Facebook story / reel URL parsing + HTML CDN extract
- Story progress rail (multi-segment)
- Manual paste mode (JSON or page source) when proxies fail
- Save current media (blob download when CORS allows, else open tab)
- Keyboard: `←` `→` segments, `Esc` stop
- Demo mode for UI QA
- Settings in `localStorage` only

---

## Supported link shapes

**Instagram**
- `https://www.instagram.com/stories/<username>/<media_id>`
- `https://www.instagram.com/p/<shortcode>/`
- `https://www.instagram.com/reel/<shortcode>/`

**Facebook**
- `https://www.facebook.com/stories/<page_id>/<token>`
- `https://www.facebook.com/story.php?story_fbid=…&id=…`
- `https://www.facebook.com/reel/<id>`

Username-only story URLs and private accounts will not resolve without Instagram’s private API — by design.

---

## Limitations (honest)

- Public CORS proxies are flaky and may log URLs.
- Stories expire in ~24h; links die.
- No private-account access, no anonymity guarantee toward Meta.
- May conflict with platform ToS — personal/educational use only; respect copyright.

---

## Project layout

```
story-glass/
  index.html
  css/styles.css
  js/app.js
  js/parser.js
  js/fetcher.js
  js/player.js
  js/platforms/instagram.js
  js/platforms/facebook.js
  worker/cors-relay.js
  ANALYSIS.md
  README.md
```

---

## License

Use and modify freely for your own projects. You are responsible for compliance in your jurisdiction and with Meta’s terms.
