# StoryGlass

Facebook & Instagram **story / video viewer**. Paste a public link → watch in the browser.  
No visitor accounts. No app install.

**Built for the viewer-list problem:** Instagram and Facebook put your name on every public story you open. Accidental taps, “just checking” looks, competitor research, quiet curiosity — all of it becomes a receipt. People get screenshotted, soft-blocked, or blocked after one open. StoryGlass is a browser tool for public links so you don’t have to open the official app (and hand over your identity) just to watch something that’s already public.

Honest limits: Facebook public videos resolve without your account. Instagram stories often need a server session, and that session *can* appear as a viewer — we don’t market a fake “100% anonymous” guarantee.

## Product

1. User pastes a Facebook or Instagram URL  
2. App calls **same-origin** `GET /api/resolve?url=` (no settings, no “relay” jargon)  
3. Story rail player + Save  

Fallback: **Having trouble?** → paste page source / JSON.

## Deploy (Vercel) — zero config for visitors

```powershell
cd story-glass
npx vercel login
npx vercel --prod --yes
```

That’s it. `api/resolve.js` ships with the static site.

Optional Instagram stories (server session — may appear as a viewer on the creator’s story):

```powershell
npx vercel env add IG_SESSIONID production
npx vercel --prod --yes
```

## Local dev

```powershell
# API + static (simulates Vercel)
node scripts/dev-server.mjs
# if you need the Node resolve helper on :8787
node scripts/local-relay.mjs
```

Open `http://127.0.0.1:4173`. The app hits `/api/resolve` on the same origin when available.

For pure static local without Vercel functions, start `local-relay.mjs` and set (console only):

```js
localStorage.setItem('sg.relay', 'http://127.0.0.1:8787')
```

## What works (measured)

| Link | Status |
|------|--------|
| Facebook public `watch/?v=` / `/videos/` | Works (HTML extract, no login) |
| Instagram stories | Needs server `IG_SESSIONID` or paste fallback |
| Private / expired | Fails with a clear message |

## Honesty

- “No account” = no **StoryGlass** signup  
- Not a stealth viewer: IG session mode can show that account as a viewer  
- Does not bypass private accounts  

Docs: [ANALYSIS.md](./ANALYSIS.md) · [RESEARCH.md](./RESEARCH.md)

## GitHub

Private repo: https://github.com/JehadurRE/story-glass
