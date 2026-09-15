# How Instagram / Facebook story resolve works (and why BraveDown “just works”)

## The real blocker

In 2026 story media is **not** given to logged-out datacenter clients.

### Instagram

| Call | Result |
|------|--------|
| `GET /api/v1/feed/user/{id}/story/` | fail without session |
| Profile HTML | login-wall SPA, **0** media URLs |

### Facebook page live story (`fpvanik`)

| Call | Result |
|------|--------|
| Profile HTML `story_bucket` | **Works** — we can see a live story exists |
| `GET /stories/{pageId}/{storyFbid}` | Empty shell (logged-out / datacenter) |
| BraveDown | Real mp4s (`fb-story-profile-…`) |

We re-tested BraveDown on `instagram.com/hail_afgani/` and `facebook.com/fpvanik`:

- **BraveDown:** live story media via their server
- **Us without session:** detect story, media blocked
- **Us with a real cookie:** same story viewer path they use

## What StoryGlass implements

```
Browser
  └─ GET /api/resolve?url=…
       └─ Vercel function
            ├─ FB: profile HTML → story_bucket → story viewer (optional FB_COOKIE)
            ├─ IG: username → user_id → feed/user/{id}/story/ (optional IG_SESSIONID)
            └─ return { items: [{ type, url, … }] }
```

We **never** `POST` Instagram `media/seen/`.  
We **cannot** promise a session is invisible — Meta may still list it as a viewer.

## Setup (once)

### Instagram stories

1. Throwaway IG account → browser DevTools → Cookies → `sessionid`
2. Vercel env: `IG_SESSIONID`
3. Redeploy

### Facebook page live stories (same class as BraveDown)

1. Throwaway Facebook account → log in at facebook.com
2. DevTools → Application → Cookies → `facebook.com`
3. Copy **`c_user`** and **`xs`** (or the full cookie string)
4. Vercel env: **`FB_COOKIE`** = `c_user=…; xs=…;` (more cookies help)
5. Redeploy

Local:

```powershell
$env:IG_SESSIONID = "<ig sessionid>"
$env:FB_COOKIE = "c_user=…; xs=…;"
node scripts/local-relay.mjs
```

## If stories stop working

Rotate cookies. Typical errors:

- IG “Please wait a few minutes…” → challenge / rate limit  
- FB “still blocked the story player” → session expired or IP still challenged  

## Why not pure client-side?

CORS + login wall. Commercial tools (BraveDown included) hold server sessions. We are open about that — you bring the session; we don’t scrape their backend.

