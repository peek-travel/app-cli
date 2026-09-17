---
name: peek-manifest-and-deploy
description: >-
  The concrete Peek manifest, registration, and deploy — how to register, configure, and ship a
  starter-kit app to a Peek Pro account. Covers the app.json manifest (extendables keyed by
  platform, the registry settings URL that is the embed URL Peek POSTs to), what app.json
  deliberately does NOT hold (slug, base_url, listing copy), the .peek-kit.json project file, the
  two-app/two-environment split (your app in prod vs its test app in sandbox), what
  `npx @peektravel/app-cli dev` does, `use-url` at deploy time, the PEEK_APP_SECRET / PEEK_APP_ID /
  PEEK_APP_URL / PEEK_API_URL env contract, the Peek Development Hub, and the Vercel + Neon (not
  Supabase) hosting recommendation. Use when editing app.json, setting up env/secrets, registering
  the app with Peek, changing the embed/webhook URLs, or deploying. Triggers on "app.json",
  "manifest", ".peek-kit.json", "Development Hub", "deploy", "Vercel", "Neon", "Supabase", "env
  vars", "secrets", "register the app", "peek dev", "use-url", "sandbox vs prod", "test app",
  "401 after deploy", "which manifest".
---

# Peek manifest, registration & deployment

This is the **concrete Peek mechanism** for shipping an app. The generic concept — a manifest
declares the app to the platform's registry; keep one coherent `{id, secret, api, base_url}` set
per environment or every request 401s; hand the user a complete env checklist — lives in
`manifest-and-deploy`. Read that for the *why*; this skill is the authoritative *how it works on
Peek*.

Getting an app from this starter kit into a Peek Pro account has three parts: the **manifest**
(`app.json`), **registration** in the Peek Development Hub, and **deployment** to your host.

> **Hosting is your choice — this skill recommends a default, it doesn't mandate one.**
> Language/framework/SDK/test-runner are fixed by the kit (`javascript-nextjs`); the **host and
> database are the "moving layer"** you pick per project. Recommended default: **Vercel** (hosting)
> + **Neon serverless Postgres** (data, when you add persistence), accessed **server-side only**
> via a `DATABASE_URL`, live UI driven by polling/SSE from your own API routes. Swap it for any
> Node-capable host/DB.

> **Why Neon and not Supabase?** Supabase's value is a bundle built around **its own auth** — Row
> Level Security keyed to a Supabase-signed JWT, client-direct DB access, Realtime gated by RLS.
> This kit authenticates every request with **Peek's token instead** (verified server-side; the
> browser never touches the DB — it calls your API routes, which scope data by `installDataId`).
> So Supabase's differentiators go unused, and its third-party-auth path **can't even accept the
> Peek token**: it requires *asymmetrically* signed JWTs, but the peek-auth token is
> *symmetrically* signed with `PEEK_APP_SECRET`. You'd end up using only the service-role key and
> bypassing RLS — paying in complexity for features you can't use. **Neon is just Postgres** (one
> server-side connection string, scope rows by `installDataId`) — exactly the shape this
> architecture needs. Use Supabase only if you have a specific reason to.

## 1. The manifest — `app.json`

`app.json` declares **what the app plugs into**, and nothing else. It is a flat object of
extendables keyed by who consumes them — `registry` plus one key per platform:

```json
{
  "registry": [
    { "slug": "app_registry_settings_url@v1",
      "configuration": { "url": "/examples/peek-pro/main", "url_mode": "prepend_base_url" } },
    { "slug": "app_registry_webhook@v1",
      "configuration": { "url": "/examples/webhooks/install-status" } }
  ],
  "peek": [ { "slug": "peek_backoffice_api@v1", "configuration": {} } ],
  "acme": null,
  "cng": null
}
```

- **`peek`** — the platform capabilities the app requests. This kit ships
  **`peek_backoffice_api@v1`**, which is what grants the app access to the back-office API used via
  `PeekAccessService` (see `peek-backoffice-api`). The key holding a **list** is what makes the app
  run on Peek: platform support is *derived* from these keys, `null` means "not on that platform",
  and a key you **leave out** means "leave that platform as it is."
- **`registry`** — how Peek surfaces the app. This kit ships
  **`app_registry_settings_url@v1`** with `url: "/examples/peek-pro/main"` and
  `url_mode: "prepend_base_url"` — i.e. Peek loads `<base_url>/examples/peek-pro/main` (the embed
  entry route) inside the iframe. **This URL is what Peek POSTs to** — it must match the embed
  route (see `peek-embed-and-auth`). If you add a **webhook**, its endpoint URL is declared here
  too (see `peek-webhooks`).

**Three things are NOT in app.json, and putting them back breaks the push (unknown keys are a
400):**

| Not in the manifest | Where it lives |
| --- | --- |
| The app's **slug** | `.peek-kit.json` (`app.id`), and in the URL the CLI pushes to. One manifest can therefore be pushed at your real app *and* at its test app. |
| **`base_url`** | Set per environment: `peek dev` points the test app at the tunnel, `peek use-url <url>` points an app at a deployed host. |
| **Name, description, icon, screenshots, categories** | A per-platform **listing**, written and reviewed in the portal (*Apps → your app → Distribution*). The same build can read differently on PeekPRO and ACME, so it cannot live in the file that describes the build. `peek init --with-claude` drafts this copy into `LISTING.md` for you to paste in. |

> When you change the embed path or add a webhook/MCP endpoint, update `app.json` and push it
> (`peek sync-app`); `peek dev` pushes it for you on every restart.

### `.peek-kit.json` — the project file

Committed, CLI-owned, and small: `app.id` (the app this directory publishes to), `app.testId`
(the test app the dev loop uses), plus the starter kit / CLI version / platform it was scaffolded
with. **Don't hand-edit `app.id` on a live app** — it is the identity the registry knows you by.

## The two-app / two-environment split — the #1 source of 401s

You are really juggling **two separate Peek apps** — one manifest, pushed at two slugs — and mixing
their identities is the most common cause of "every request 401s / blank iframe." Keep them
straight:

| | **Source / production app** | **Dev / test app** |
| --- | --- | --- |
| Slug | your real slug, `.peek-kit.json` `app.id` (e.g. `guide-shift`) | the test slug the registry derives, `app.testId` (e.g. `guide-shift-test-dev`) |
| Manifest | `app.json` — the **same file** is pushed at both | same `app.json` |
| `base_url` | your deployed URL, set with `peek use-url <url> --prod` | the ephemeral **tunnel URL**, re-set on every `peek dev` run |
| Installations API | `https://apps.peek.com/installations-api` (`PEEK_API_URL` default) | same — `https://apps.peek.com/installations-api` |
| id + secret live in | the **host's** env, set by you at deploy | `.env.local`, written by `peek dev` |

**What `npx @peektravel/app-cli dev` actually does** (so you know which app is live locally): it
pushes `app.json` at your source app as an **unpublished draft** (creating the app on the first
run), asks the registry for that app's **test app** (the same one every run — its slug is recorded
in `.peek-kit.json`), pushes the **same manifest** at the test app, points the test app at the live
tunnel URL, and publishes it. Then it **writes `.env.local` for you** — `PEEK_APP_ID` (test app),
`PEEK_APP_SECRET` (test app), `PEEK_APP_URL` (tunnel), and `PEEK_API_URL` (only when pointed at a
non-production registry). Your source app is never published from here and never receives the
tunnel URL. **So under `peek dev` the app embedded in the iframe is the TEST app — your env must be
that test app's env.**

**Two invariants — break either and every request 401s:**

1. **`PEEK_APP_ID` / `PEEK_APP_SECRET` must belong to the same app whose tokens you verify.** The
   peek-auth token is signed with the *issuing app's* secret; your runtime verifies it with
   `PEEK_APP_SECRET` (see `peek-embed-and-auth`). If the iframe is running the **test** app but
   `.env.local` / the host still holds the **prod** app's id+secret (or vice versa), **every verify
   fails → 401**, with nothing obviously wrong.
2. **`PEEK_API_URL` (sandbox vs prod) must match where the app is registered.** The test app lives
   in **sandbox**, the prod app in **prod**. `PeekAccessService` mints its own API tokens and calls
   the installations API at `PEEK_API_URL`; point it at the wrong environment and the install isn't
   found / calls fail. `peek dev` sets the sandbox URL for you; a **production deploy must use the
   prod `PEEK_API_URL`** (the default) with the **prod** app's id+secret.

> **`PEEK_APP_ID` is in the back-office gateway *path*, but nothing verifies it — so a wrong id
> passes every auth check and only fails at the back-office.** `PeekAccessService` builds the
> gateway URL as `{PEEK_API_URL}/{PEEK_APP_ID}/peek_backoffice_api-v1/sales` (the id is the
> `gatewayKey`; see `peek-embed-and-auth`). But `verifyPeekAuthToken` **and** the webhook validate
> only the **secret** (`PEEK_APP_SECRET`) — never the id. So a wrong `PEEK_APP_ID` **passes the
> token check *and* the webhook check**, then **404s the back-office** because the gateway path
> points at a nonexistent app. Symptom: auth looks fine, back-office calls 404. If a wrong secret
> is the classic 401, a wrong id is the sneaky 404.

**Rule of thumb: one coherent set at a time.** `{app id, app secret, API URL, base_url}` must all
describe the *same* app in the *same* environment. Local dev = the test app in sandbox (managed in
`.env.local` by `peek dev`); production = your real app in prod (managed in the host's env). Don't
cross the streams.

**Symptom → cause.** The failure surface tells you which knob is wrong:

| Symptom | Likely cause |
| --- | --- |
| **Webhook 401** (delivery rejected) | Wrong `PEEK_APP_SECRET` — the webhook validates the secret only |
| **Back-office 401** (peek-auth passes, API call rejected) | Wrong `PEEK_API_URL` env — pointed at the wrong environment (prod vs sandbox) for where the app is registered |
| **Back-office 404** (auth passes, gateway not found) | Wrong `PEEK_APP_ID` (it's in the gateway path — see above) **or** an unsynced/undeclared extendable (`peek_backoffice_api@v1` missing from `app.json` / not re-synced — run `peek sync-app`) |

> There is no second manifest file to keep in step any more — the test app is a *slug*, not a file.
> (An app scaffolded before this change carries an `app-dev.json`; the CLI migrates it away the
> next time you run `peek dev`, moving the test app's slug into `.peek-kit.json`.) The secret
> `peek dev` writes to `.env.local` is already covered by the repo's `.env*` gitignore.

## 2. Registration — the Peek Development Hub

- Get access to the Peek **Development Hub**. `TODO(verify)` Hub URL + onboarding steps.
- Register the app; obtain its **app ID** (`PEEK_APP_ID`) and **shared secret** (`PEEK_APP_SECRET`
  — used to verify the peek-auth JWT; see `peek-embed-and-auth`).
- Confirm the **sandbox** environment and validate there before production. Never test against a
  live account. How sandbox vs. production credentials/endpoints differ is a Development Hub detail
  — `TODO(verify)` it there or ask the user; don't assume.
- The app's **runtime** Peek auth is per-install via the token flow — there is **no login the
  developer or user creates**. Registration just provisions the app's identity/keys.

## 3. Environment & secrets

Env is validated by `lib/env.ts` (Zod — the schema pattern is a `javascript-nextjs` concern).
Required:

| Var | What | Notes |
| --- | --- | --- |
| `PEEK_APP_SECRET` | Shared secret for verifying the peek-auth JWT | **Secret** — never commit. Must be the secret of the **same app** whose tokens you verify (see the split above) |
| `PEEK_APP_ID` | The app's ID / issuer | From the Development Hub. Must pair with the matching `PEEK_APP_SECRET` — same app |
| `PEEK_APP_URL` | The app's own public base URL | Used to build the embed redirect target and dev origins |
| `PEEK_API_URL` | Peek back-office API base | Defaults to `https://apps.peek.com/installations-api` — the same URL `peek dev` writes to `.env.local` |

> These four are not independent knobs — `{PEEK_APP_ID, PEEK_APP_SECRET, PEEK_API_URL,
> PEEK_APP_URL}` must all describe the **same app in the same environment** (prod *or* sandbox). A
> prod secret with a sandbox API, or a test-app id verifying prod tokens, 401s every request.
> `peek dev` keeps the sandbox set coherent in `.env.local`; you keep the **prod** set coherent in
> the host's env.

**Any var an app adds is required too.** As a build introduces persistence or integrations
(`DATABASE_URL`, a webhook signing secret, third-party API keys), **register each in `lib/env.ts`'s
Zod schema** so it's validated on boot, and add it to the production set. The four above are the
kit's baseline, **not** the whole list for a finished app. A var set locally but missing on the
host is the most common post-deploy failure (the app 500s on first request — see the misconfig→500
split in `peek-embed-and-auth`).

**Secret hygiene:** secrets live in your **host's secret store** — Vercel **Environment Variables**
by default — never in the repo or the client bundle. If you add Neon, keep the **`DATABASE_URL`
server-only** — there is no client-direct DB access in this kit. No PII or tokens in logs. In CI,
the build uses **placeholder** env values (see `.github/workflows/ci.yml`) purely to satisfy env
validation.

## 4. Deployment — Vercel (recommended default)

Next.js deploys to **Vercel** with zero Docker config — Vercel builds it natively (the Next build
specifics are a `javascript-nextjs` concern). This is the recommended default; any Node-capable
host works.

- **Connect the repo** to a Vercel project (Import Git Repository).
- **Set env vars** in the project settings (the four in §3; the Neon `DATABASE_URL` if used).
- **Build/output** is detected automatically for Next.js — no `Dockerfile` needed on Vercel.
- **`.github/workflows/ci.yml`** — on every branch: lint → typecheck → test w/ coverage → build.
  Keep it green (see `testing`). Host-agnostic; stays.

> **Data/persistence (when needed):** Phase 0 ships no database. When you add one, **Neon
> (serverless Postgres)** is the recommended default — create a project, take its `DATABASE_URL`
> (server-only), connect from your API routes, and scope rows to `installDataId` (see
> `peek-backoffice-api`). **Not Supabase** — see the "Why Neon and not Supabase?" note at the top.

> **Ignore the Fly.io files.** `Dockerfile`, `fly.toml`, and `fly-deploy.yml` are placeholder
> scaffolding scheduled for removal — don't build a Fly deploy around them.

**First-time deploy checklist:**
- [ ] Development Hub access; **prod** app registered → its `PEEK_APP_ID` + `PEEK_APP_SECRET` (the
      prod app's, **not** the `peek dev` test app's).
- [ ] Vercel project created and connected to the repo.
- [ ] `PEEK_APP_URL` set to the deployed URL, and the **prod app** pointed at the same origin:
      `peek use-url https://<your-host> --prod` (this is what sets `base_url` — it is not a field
      you can edit in `app.json`).
- [ ] Host env is one **coherent prod set**: `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_APP_URL`, and
      `PEEK_API_URL` (prod default — do **not** carry over the sandbox URL from `.env.local`); Neon
      `DATABASE_URL` if used.
- [ ] Declare the embed URL (`<base_url>/examples/peek-pro/main`) and any webhook/MCP URLs in
      `app.json` and push it (`peek sync-app`); validate in **sandbox** (the `peek dev` test app)
      first.
- [ ] Write the **listing** (name, description, icon, screenshots) in the portal under
      *Apps → your app → Distribution* — none of it comes from `app.json`.
- [ ] Confirm the embed loads in the iframe (CSP `frame-ancestors` is set in `next.config.ts` — see
      `peek-embed-and-auth`).

## Related skills

- **`cli`** (global) — the `@peektravel/app-cli` commands used throughout here: `peek dev`,
  `sync-app`, `use-url`, `extensions list`/`show`, plus `show-env` / `auth whoami` preflight and
  `--skip-env-confirm`.
- **`manifest-and-deploy`** (global) — the generic manifest→registry, 2-env-401, env-coherence
  concept behind this skill.
- **`javascript-nextjs`** (stack) — the Next build on Vercel and the `lib/env.ts` Zod validation
  pattern.
- **`peek-embed-and-auth`** — the embed route the manifest points at; how `PEEK_APP_SECRET` is used
  and the misconfig→500 vs bad-token→401 split.
- **`peek-backoffice-api`** — the `peek_backoffice_api@v1` extendable grants this API access;
  `installDataId` scoping for any DB.
- **`peek-webhooks`** / **`peek-mcp-endpoint`** — webhook and MCP endpoint URLs are declared in the
  manifest/registry too.
