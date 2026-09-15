# StoryGlass — Deep Analysis

**Product goal:** Facebook + Instagram story viewer. No visitor account. Maximize client-side work.

**Reference:** [BraveDown Facebook Story Viewer](https://bravedown.com/facebook-story-downloader)

**Live reverse-engineering (curl/Livewire/JWT):** see [RESEARCH.md](./RESEARCH.md)

---

## 1. What BraveDown actually is

| Aspect | Observation |
|--------|-------------|
| Model | Server-backed multi-platform downloader (TikTok, FB, IG, Douyin, Bilibili, VK…) |
| UX | One URL field → process → media cards → download |
| Access | Guest mode with rate limit (10 downloads / 2h window); Pro removes ads/limits |
| Claims | “No login required” = no *visitor* account; their *servers* still call Meta |
| Scope | FB Story + many other platforms as separate landing pages |

**Takeaway:** Their “no login” promise is product UX, not architecture. The browser never talks to Meta directly.

---

## 2. Hard constraint: pure browser → Meta is blocked

### 2.1 CORS

`facebook.com` and `instagram.com` do **not** send `Access-Control-Allow-Origin` for private/web APIs.

```text
fetch('https://www.instagram.com/api/v1/media/…/info/')
→ TypeError: Failed to fetch  (CORS preflight / opaque response)
```

`mode: 'no-cors'` returns an opaque response — the JS cannot read the body. Dead end for parsing.

### 2.2 Why even “public” stories fail from a static page

1. **Private APIs** (`i.instagram.com/api/v1/...`, Graph story buckets) require app tokens, signed headers, and often a session cookie.
2. **Web GraphQL** requires `X-IG-App-ID`, `X-CSRFToken`, mid/ig_did cookies, and consistent UA.
3. **HTML scrape of `/stories/<user>/<id>`** — same-origin only. Also heavily bot-gated (login walls, checkpoints).
4. **CDN media** (`scontent*.cdninstagram.com`, `fbcdn.net`) — `<img>` / `<video>` can *display* cross-origin without CORS. `fetch()` for blob download often fails unless the CDN echoes ACAO.

### 2.3 What *does* work without a user account

| Method | Client-side? | Visitor account? | Reliability | Notes |
|--------|--------------|------------------|-------------|-------|
| Your backend / Worker calls Meta | No | No | Medium | What BraveDown does |
| Public CORS proxy → Meta | Yes (JS) | No | Low–Medium | Rate limits, privacy, flaky |
| User-owned edge relay (Cloudflare Worker) | Nearly | No | Medium | Free tier, ~50 lines |
| Manual paste (open endpoint, copy JSON) | 100% | No | High for public media IDs | Human bypasses CORS |
| Browser extension host permissions | Extension | No | High | Not a website |
| Official Graph / IG Graph API | No | App token, not user | High for *authorized* pages only | Not for arbitrary stories |

**Conclusion:** A BraveDown-like *website* cannot be 100% static *and* reliably fetch stories. We can still be **visitor-account-free** and **client-first**, with a thin optional relay.

---

## 3. Story URL map (what we parse)

### Instagram

| Pattern | Meaning |
|---------|---------|
| `instagram.com/stories/<username>/<story_id>` | Specific story media (best case) |
| `instagram.com/stories/<username>` | Current public story tray of user (hard without private API) |
| `instagram.com/p/<shortcode>/` or `/reel/<shortcode>/` | Post/reel (bonus, not story) |
| `instagram.com/<username>/` | Profile only |

Story `story_id` ≈ media pk. We try:

```http
GET https://www.instagram.com/api/v1/media/{id}/info/
```

with browser-like headers (via relay/proxy). If Meta returns JSON, we extract `image_versions2` / `video_versions`.

### Facebook

| Pattern | Meaning |
|---------|---------|
| `facebook.com/stories/<page_or_user>/<token>` | Story viewer route |
| `facebook.com/story.php?story_fbid=&id=` | Older story link |
| `facebook.com/reel/<id>` | Reel (adjacent) |
| `facebook.com/watch/?v=` | Watch video (adjacent) |

Story-specific Graph without a token is unreliable. Best path: fetch the story HTML through a relay and regex-extract `scontent` / `fbcdn` video and image URLs (same technique many downloaders use).

---

## 4. Architecture chosen for this project

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (100% of UI, parse, player, download attempts)     │
│                                                             │
│  URL parse → platform detect → strategy chain               │
│       │                                                     │
│       ├─ 1. User-defined relay (Cloudflare Worker)          │
│       ├─ 2. Public CORS proxies (fallback)                  │
│       └─ 3. Manual paste (JSON / page HTML) — zero network  │
│                    to Meta from this origin                 │
│                                                             │
│  Result → story rail + photo/video player + save buttons    │
└─────────────────────────────────────────────────────────────┘
         optional (free):
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker `/fetch?url=`                            │
│  - Adds CORS headers                                        │
│  - Forwards UA / Accept                                     │
│  - Does not store media                                     │
│  - Visitor has no account on your product                   │
└─────────────────────────────────────────────────────────────┘
```

### Design decisions

1. **No visitor accounts, ever.** Settings (relay URL) live in `localStorage`.
2. **No media hosting.** We resolve CDN URLs and point `<video>`/`<img>` at Meta’s CDN, or download via fetch when CORS allows.
3. **Graceful degradation.** Auto mode → proxy mode → manual paste → clear error with next step.
4. **Honest copy.** We do not claim “100% anonymous” or “always HD.” Stories expire; private accounts stay private.
5. **Bonus:** also resolve public IG posts/reels when a non-story link is pasted (same media info path).

---

## 5. Product / UX analysis (vs BraveDown)

| Feature | BraveDown | StoryGlass (this build) |
|---------|-----------|-------------------------|
| Platforms | Many | Facebook + Instagram only (focus) |
| Visitor login | Optional (limits without) | Never |
| Rate limit | 10 / 2h guest | None from our side (proxy limits apply) |
| Server | Full backend | Optional 50-line Worker |
| Story player | Download-oriented | Story rail + autoplay segments |
| Manual mode | No | Yes (paste JSON/HTML) |
| Honesty on privacy | Soft | Explicit |

---

## 6. Risks & compliance (read before production)

- **Terms of Service:** Scraping Meta may violate their ToS. This project is for personal/educational use and for content you own or have rights to.
- **Private accounts:** We do not attempt to bypass login or private audiences.
- **Expired stories:** Stories live ~24h; links may 404.
- **Proxy abuse:** Public CORS proxies log URLs; do not send secrets. Prefer your own Worker.
- **Legal:** Downloading others’ content for redistribution can infringe copyright. UI and README say “only content you own or may save.”

---

## 7. SEO / growth notes (from BraveDown’s playbook)

- Separate landing concepts: “Instagram Story Viewer” + “Facebook Story Viewer” (can share this SPA with hash routes or path copies).
- FAQPage + WebApplication JSON-LD (we ship minimal schema).
- Tutorial steps with how-to copy-link instructions.
- Avoid fake claims (anonymous, 100% HD, private bypass) — they hurt trust and SEO quality scores long-term.

---

## 8. Honest capability matrix

| Input | Expected result (public content) |
|-------|----------------------------------|
| IG story URL with media id | Best chance via `/media/{id}/info/` |
| IG story URL username only | Often empty without private story API |
| FB story URL | HTML extract of CDN URLs via relay |
| IG post/reel URL | Often works via media info |
| Private / login-walled | Fail with clear message |
| Expired story | Fail with clear message |

---

## 9. File map

| Path | Role |
|------|------|
| `index.html` | App shell + landing content |
| `css/styles.css` | Design system (dark instrument panel) |
| `js/app.js` | UI state, events, render |
| `js/parser.js` | URL / HTML / JSON extraction |
| `js/fetcher.js` | Relay + proxy chain |
| `js/player.js` | Story segments, progress rail, keyboard |
| `js/platforms/instagram.js` | IG-specific resolution |
| `js/platforms/facebook.js` | FB-specific resolution |
| `worker/cors-relay.js` | Optional Cloudflare Worker |

---

## 10. Recommendation

Ship the static SPA immediately (GitHub Pages / Cloudflare Pages / Netlify). Deploy the Worker under your domain for reliability. Keep manual paste as the “works when proxies die” path. Do not market as a private-story or anonymity tool.
