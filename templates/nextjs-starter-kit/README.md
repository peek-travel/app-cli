# {{APP_NAME}}

Starter kit for building a **Peek Pro app** — a [Next.js](https://nextjs.org)
app that embeds inside the Peek Pro back-office as an iframe. This is your
starting point; build your feature on top of it.

> **This is not stock Next.js.** The version here ships breaking changes to
> APIs, conventions, and file structure. Read `AGENTS.md` and the relevant
> guide in `node_modules/next/dist/docs/` before writing code.

## Architecture in one minute

The app runs as a **client-side SPA inside the Peek Pro iframe**. It cannot use
Server Components or SSR data fetching for embedded views, because everything is
gated on a JWT that only exists in the browser:

1. Peek Pro **POSTs** a signed peek-auth JWT to `/peek-pro/main`. The route
   handler ignores the body and **redirects to the GET view** — it does not
   authenticate here (the token can't survive a redirect; cookies are blocked
   in third-party iframes).
2. The SPA boots and requests its own token from the parent frame via
   `postMessage` (`app/peek-pro/client/api.ts`). This is the single token
   channel — one requester, one listener.
3. Every API call attaches that token as a Bearer header. Route handlers verify
   it via the auth library and scope the Peek service to the caller's claims
   (`lib/with-peek.ts`, `lib/peek-service.ts`).

`postMessage` and the iframe embed are **origin-locked** to `peek.com` /
`peek.stack` (any subdomain depth) — see `frame-ancestors` in `next.config.ts`
and `isPeekOrigin` in `app/peek-pro/client/api.ts`.

See `AGENTS.md` for the full constraints (no cookies, no SSR fetch,
library-owned verification). Read it before changing auth, the embed, or CSP.

## Getting Started

Install and run the dev server:

```bash
pnpm i
pnpm dev
```

The app expects to be embedded in Peek Pro. To develop, register a dev install
in the Peek Development Hub and open the app from there.

## Environment variables

Set these (e.g. in `.env.local`) — validated in `lib/env.ts`:

| Var | Required | Description |
| --- | --- | --- |
| `PEEK_APP_SECRET` | yes | App secret used to verify the peek-auth JWT. |
| `PEEK_APP_ID` | yes | Your app's ID from the Development Hub. |
| `PEEK_APP_URL` | yes | Full public URL of this app (used for the embed redirect). |

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm start            # serve the production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:coverage
```

## Project layout

- `app/peek-pro/main/route.ts` — POST/GET embed entry (redirect only).
- `app/peek-pro/main/view/` — the embedded SPA (client components).
- `app/peek-pro/main/api/` — authenticated API routes.
- `app/peek-pro/client/api.ts` — token handshake + authenticated `apiFetch`.
- `lib/` — env parsing, JWT verification, Peek service, `with-peek` wrapper.
- `app.json` — the Peek app manifest (extendables, settings URL, listing).

## Deploy

Recommended: **Vercel** for the app + **Supabase** for any persistence. Set the
env vars above in your host, then register the deployed URL as the embed URL in
the Peek Development Hub. Fly.io also works (`fly launch`).

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
