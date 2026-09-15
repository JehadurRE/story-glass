# How Instagram story resolve works (and why BraveDown “just works”)

## The real blocker

In 2026 Instagram **does not** give story media to logged-out clients:

| Call | Result (this datacenter) |
|------|---------------------------|
| `GET /api/v1/feed/user/{id}/story/` | `status:fail` “something went wrong” |
| `GET /api/v1/users/web_profile_info/` | 401 `require_login` |
| Profile HTML | ~625KB login-wall SPA, **0** media URLs |
| GraphQL doc_ids | `execution error` / `require_login` |
| oEmbed | HTML shell, not oEmbed JSON |

We re-tested this against BraveDown on `instagram.com/hail_afgani/`:

- **BraveDown:** success — filename `IG Stories - hаil_afgani`, real `fbcdn` jpg via their JWT CDN
- **Us without session:** login wall
- **Us with a real `sessionid`:** same API BraveDown uses (`feed/user/{id}/story/`)

So BraveDown is not magic. They hold a **logged-in Instagram session on their servers**, resolve `username → user_id`, then **GET** the story feed. That’s the same architecture we ship.

## What StoryGlass implements

```
Browser
  └─ GET /api/resolve?url=https://instagram.com/<user>/
       └─ Vercel function
            ├─ read env IG_SESSIONID (or IG_COOKIE)
            ├─ GET instagram.com/<user>/  → extract user_id
            ├─ GET i.instagram.com/api/v1/feed/user/{id}/story/   ← GET only
            └─ return { items: [{ type, url, … }] }
```

We **never** `POST /api/v1/media/seen/` (the explicit “mark viewed” call).  
We **cannot** promise the session account is invisible — Instagram may still list it as a viewer.

## Setup (once)

1. Use a **throwaway** Instagram account (not your main).
2. Log in in a browser → DevTools → Application → Cookies → `instagram.com` → copy **`sessionid`**.
3. Vercel → Project → Settings → Environment Variables:
   - Name: `IG_SESSIONID`
   - Value: the raw sessionid (or a full cookie string containing `sessionid=…`)
   - Environments: Production (+ Preview if you want)
4. Redeploy (`git push` is enough if auto-deploy is on).

Local:

```powershell
$env:IG_SESSIONID = "<paste>"
node scripts/local-relay.mjs
```

## If stories stop working

Session expired or challenged. Rotate the cookie. Typical errors:

- “Please wait a few minutes…” → rate limit / challenge  
- “We're sorry, but something went wrong.” → dead session or no stories  
- Empty items → account has no live stories right now  

## Why not pure client-side?

CORS + login wall. A static page cannot read Instagram story JSON. Commercial tools (BraveDown included) all use a server-held session. We are open about that.
