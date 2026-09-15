# BraveDown reverse-engineering (2026-09-15)

Educational analysis of publicly exposed frontend/server behavior for `bravedown.com/instagram-video-downloader`.  
Not for abusing their service or redistributing media.

Artifacts: `research/` (HTML, Livewire payloads, JWT samples).

---

## 1. Stack

| Layer | Technology |
|-------|------------|
| App | **Laravel** + **Livewire** (`public.tool.downloader-public`) |
| Edge | **Cloudflare** |
| Session | `bravedown_session` + `XSRF-TOKEN` cookies |
| Client JS | jQuery, Bootstrap, Livewire, `spark-md5` (loaded; no critical path use found for download) |
| Download CDN | `hcdn` / `kcdn` / `acdn.bravedown.com/download?token=JWT` |
| A/V merge | `https://render.bravedown.com/render.php` (when `stream_vid=true`) |
| B2B API | RapidAPI listing (`bravedownz`) — they sell the same scraper |

---

## 2. Request flow (what the browser actually does)

```text
GET /instagram-video-downloader
  → HTML + wire:snapshot (component state) + CSRF
  → cookies: bravedown_session, XSRF-TOKEN

User pastes URL → wire:model.defer="zlinkz"
Submit → wire:submit.prevent="onDownload"

POST /livewire/update   (JSON)
  X-Livewire: true
  X-CSRF-TOKEN / X-XSRF-TOKEN
  body: {
    _token,
    components: [{
      snapshot: "<stringified original snapshot>",  // checksum intact
      updates: { zlinkz: "<url>" },
      calls: [{ path: "", method: "onDownload", params: [] }]
    }]
  }

Server resolves media (private APIs / scrapers — not in browser)
  → new snapshot.data = {
      zlinkz, status, message, data[],
      stream_vid, stream_thumb, render_mode
    }
  → effects.html = result cards
```

**Critical detail:** mutate `zlinkz` only via `updates`. Rewriting `snapshot.data.zlinkz` without a valid checksum → HTTP 500.

### Live results from this machine

| Input | Status | Notes |
|-------|--------|-------|
| FB video `facebook.com/facebook/videos/10153231379946729/` | **success** | HD+SD mp4 via hcdn JWT |
| IG profile `instagram.com/nasa/` | **success** | Live **stories** (jpg + dash mp4) |
| IG post/reel shortcodes | **error** | “private link or a server error!” (their IG post path currently failing) |
| `fb.watch/abc/` | **error** | Format validator: wants `facebook.com/stories/…` or `/share/…` |
| No URL | **error** | “Please verify you are human!” |

Guest UI: **10 downloads / 2h**.

---

## 3. Response shape (success)

```json
{
  "status": "success",
  "message": "Download completed successfully! ...",
  "render_mode": true,
  "stream_vid": true,
  "stream_thumb": true,
  "data": [{
    "duration": "01:14",
    "key": "fb-video-10153231379946729",
    "links": [[[ { "url": "https://hcdn.bravedown.com/download?token=…", "…": "…" } ]]]
  }]
}
```

### JWT on download URLs (`HS256`)

Decoded payload:

```json
{
  "url": "https://video-….xx.fbcdn.net/….mp4?…&dl=1",
  "filename": "[Facebook Video] …",
  "type": "mp4",
  "exp": 1789550598
}
```

- Proxied GET `hcdn…/download?token=…` → **200**, `video/mp4` or `image/jpeg`, **`Access-Control-Allow-Origin: *`**
- Range requests work (206) — good for players
- Direct Meta CDN URL (from JWT) also **200** and (in this test) **ACAO: `*`** — so once you *have* the CDN URL, a browser `<video>` / `fetch` download can work without BraveDown

Their JWT proxy exists for **rate limits, branding, expiring URL refresh, and keeping the real CDN off the client**.

### Render service (client inline JS)

When video/audio are separate DASH streams (`stream_vid`):

```text
POST https://render.bravedown.com/render.php
  video=<b64 url>&audio=<b64 url>&error=…
→ { status: success|wait|limit|error, data: { progress, url }, queue }
```

Client polls every 2s until progress=100. This is **server-side ffmpeg merge**, not client-side.

---

## 4. What we also measured (Meta side)

| Probe | Result |
|-------|--------|
| `GET instagram.com/reel/<code>/` (Node, no cookies) | 200 SPA HTML (~625KB), **no video_urls**, **no ACAO** |
| `GET instagram.com/api/v1/media/<fake>/info/` | Same SPA HTML, not JSON |
| `?__a=1&__d=dis` | 404 not-logged-in page |
| Public CORS proxies → IG reel | 520 / 522 (proxy/CF failures) |
| IG oEmbed | Now serves IG HTML shell, not oEmbed JSON |

**Conclusion:** logged-out HTML scraping of IG posts is largely dead. Working downloaders use **server-held sessions / private APIs / third-party scrapers**, then hand the browser a **direct CDN URL** or a **tokened proxy**.

---

## 5. Architecture comparison

```text
BraveDown (confirmed)
  Browser ──Livewire──► Laravel ──► IG/FB private/scraper APIs
                              └──► hcdn JWT proxy ──► Meta CDN ──► user
                              └──► render.php (ffmpeg merge)

StoryGlass (ours)
  Browser ──parse/player/download UI── (100% client)
       │
       ├─► optional Worker ──► Meta HTML/API ──► JSON media URLs ──► <video>/<img>
       ├─► public CORS proxies (flaky)
       └─► manual paste JSON/HTML
```

| Concern | BraveDown | StoryGlass |
|---------|-----------|------------|
| Visitor account | None (guest limits) | None |
| Server required | Yes (core) | Optional (recommended) |
| Media hosted by product | Via JWT CDN proxy | No — point at Meta CDN |
| Reliability | High when their scrapers work | Depends on relay quality |
| Cost/ops | Real backend + CF + render fleet | Static hosting + free Worker |

---

## 6. Live test: `instagram.com/hail_afgani/`

| Path | Result |
|------|--------|
| BraveDown Livewire `onDownload` | **success** — filename `IG Stories - hail_afgani`, type `jpg` |
| JWT payload | points at `instagram.fsgn17-1.fna.fbcdn.net/...n.jpg` |
| `hcdn.bravedown.com` Range GET | 206, `image/jpeg`, ACAO `*` |
| Raw Meta CDN HEAD | 200, `image/jpeg`, ACAO `*` |
| Direct IG HTML (no session) | 200, ~625KB login-wall SPA, **0** media URLs |
| Our `/api/resolve` without `IG_SESSIONID` | login-wall error (expected) |
| Our `/api/resolve` FB `watch/?v=10153231379946729` | **ok, 4 mp4s** |

**Takeaway:** BraveDown’s IG story path is a **server-held session** (they label media `IG Stories - <user>`). We ship the same capability as Worker secret `IG_SESSIONID` on `i.instagram.com/api/v1/feed/user/{id}/story/`. Facebook public videos need no session and work today via HTML extract.

## 7. Implications for StoryGlass

1. **Do not promise pure static auto-resolve.** Live tests confirm Meta + public proxies are not enough from a browser.
2. **Optional Worker is the right “no account” product** — same UX promise as BraveDown guest mode, without their backend.
3. **Worker can copy the *shape* of success** (JSON media list + direct CDN URLs) without cloning their JWT/CDN business.
4. **Profile-style IG resolve** (`/nasa/` → current stories) is the path that worked on their side; shortcode posts failed for them too right now.
5. **Download**: once CDN URL is known, `fetch` + blob often works (Meta often sends ACAO on media). Fallback: open media tab.
6. **Do not** hardcode or redistribute BraveDown tokens/JWT secret; tokens are short-lived and ToS-bound.

---

## 7. Repro scripts

| Script | Purpose |
|--------|---------|
| `scripts/probe-bravedown.mjs` | First Livewire attempt (checksum fail) |
| `scripts/probe-bravedown2.mjs` | Correct `updates` payload; mine IG HTML |
| `scripts/probe-bravedown3.mjs` | Batch URL matrix |
| `scripts/probe-bravedown4.mjs` | Full success dumps + JWT decode + CDN vs hcdn |

Run:

```powershell
node scripts\probe-bravedown4.mjs
```

---

## 8. Curl cheatsheet (Livewire)

```powershell
# 1) page + cookies
curl.exe -sL -A "Mozilla/5.0" -c research\cookies.txt `
  -o research\page.html https://bravedown.com/instagram-video-downloader

# 2) extract wire:snapshot + data-csrf from page.html, then:
# POST /livewire/update with JSON body (see §2), cookies + X-CSRF-TOKEN
```

Exact working JSON examples saved under `research/lw-req-updates-only.json` and responses `research/lw-res-updates-only.txt`.
