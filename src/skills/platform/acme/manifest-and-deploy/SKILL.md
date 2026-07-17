---
name: acme-manifest-and-deploy
description: >-
  The concrete ACME manifest, registration, and deploy — how to register, configure, and ship a
  starter-kit app to an ACME account. Covers app.acme.json (the acme_backoffice_api@v1 platform
  extendable, the app_registry_settings_url that is the embed URL ACME POSTs to, the install-status
  webhook registration), the two-manifest/two-environment split and the #1 source of 401s, the
  shared PEEK_APP_SECRET / PEEK_APP_ID / PEEK_APP_URL / PEEK_API_URL env contract (no gatewayKey/mode
  for ACME), and the Vercel + Neon hosting default. Use when editing app.acme.json, setting up
  env/secrets, registering the app, changing embed/webhook URLs, or deploying. Triggers on
  "app.acme.json", "acme manifest", "acme_backoffice_api", "deploy acme app", "env vars", "register
  the acme app", "sandbox vs prod", "401 after deploy".
---

# ACME manifest, registration & deployment

This is the **concrete ACME mechanism** for shipping an app. The generic concept — a manifest
declares the app to the platform's registry; keep one coherent `{id, secret, api, base_url}` set
per environment or every request 401s; hand the user a complete env checklist — lives in
`manifest-and-deploy`. Read that for the *why*; this skill is the authoritative *how it works on
ACME*.

Getting an app from this starter kit into an ACME account has three parts: the **manifest**
(`app.acme.json`), **registration** in the Development Hub, and **deployment** to your host.

> **Hosting is your choice — this skill recommends a default.** Language/framework/SDK are fixed by
> the kit (`javascript-nextjs`); the **host and database are the "moving layer."** Recommended
> default: **Vercel** (hosting) + **Neon serverless Postgres** (data, when you add persistence),
> accessed **server-side only**. Any Node-capable host/DB works. (Why Neon and not Supabase — the
> peek reasoning applies unchanged: this kit authenticates with Peek's symmetrically-signed token,
> not a Supabase-signed JWT, so Supabase's RLS/auth differentiators go unused. See
> `peek-manifest-and-deploy`.)

## 1. The manifest — `app.acme.json`

`app.acme.json` describes the app to ACME. Key fields (templated with `{{APP_SLUG}}` /
`{{APP_NAME}}`):

- **`app.id` / `app.name`** — the app slug and display name.
- **`app_version`** — `status`, `display_version`, listing copy, `icon_url`, `base_url`, and
  **`platforms: ["acme"]`**.
- **`platform_extendables.acme`** — the platform capabilities the app requests. This kit ships
  **`acme_backoffice_api@v1`** with `configuration.permissions: ["products:read"]` — that's what
  grants access to the ACME back-office API used via `AcmeAccessService` (see `acme-backoffice-api`).
  Widen the `permissions` array only as far as the app actually needs.
- **`registry_extendables`** — how ACME surfaces the app:
  - **`app_registry_settings_url@v1`** with `url: "/examples/acme/main"` and
    `url_mode: "prepend_base_url"` — ACME loads `<base_url>/examples/acme/main` (the embed entry
    route) inside the iframe. **This URL is what ACME POSTs to** — it must match the embed route
    (see `acme-embed-and-auth`).
  - **`app_registry_webhook@v1`** with `url: "/examples/webhooks/install-status"` — registers the
    install-status webhook endpoint (see `acme-webhooks`).

> When you change the embed path or add/point a webhook or MCP endpoint, update `app.acme.json` to
> match and re-register/re-publish in the Development Hub.

> **Slug note:** the manifest requests the extendable as `acme_backoffice_api@v1`. Internally the
> SDK routes REST calls through the gateway path segment `acme_backoffice_api-v1` — you don't set
> that (the `AcmeAccessService` does); just don't be surprised the two forms differ.

## The two-manifest / two-environment split — the #1 source of 401s

You are really juggling **two separate apps**, and mixing their identities is the most common cause
of "every request 401s / blank iframe." The same discipline as Peek applies:

| | **Source / production app** | **Dev / test app** |
| --- | --- | --- |
| Manifest | `app.acme.json` (you author + publish) | a generated dev manifest at the tunnel URL |
| App id | your real slug | a test slug |
| `base_url` | your deployed URL | the ephemeral tunnel URL (rewritten each dev run) |
| Installations API | **prod** (`PEEK_API_URL` default) | **sandbox** |
| id + secret live in | the **host's** env, set at deploy | `.env.local` (written by the dev CLI) |

**Two invariants — break either and every request 401s:**

1. **`PEEK_APP_ID` / `PEEK_APP_SECRET` must belong to the same app whose tokens you verify.** The
   peek-auth token is signed with the *issuing app's* secret; your runtime verifies it with
   `PEEK_APP_SECRET`. If the iframe runs the test app but your env holds the prod app's id+secret
   (or vice versa), **every verify fails → 401.**
2. **`PEEK_API_URL` (sandbox vs prod) must match where the app is registered.** `AcmeAccessService`
   mints its own API tokens and calls the installations API at `PEEK_API_URL`; point it at the
   wrong environment and the install isn't found / calls fail.

**Rule of thumb: one coherent set at a time.** `{app id, app secret, API URL, base_url}` must all
describe the *same* app in the *same* environment. Don't cross the streams.

## 2. Registration — the Development Hub

- Get access to the **Development Hub**; `TODO(verify)` the Hub URL + ACME onboarding steps.
- Register the app; obtain its **app ID** (`PEEK_APP_ID`) and **shared secret** (`PEEK_APP_SECRET`,
  used to verify the peek-auth JWT — see `acme-embed-and-auth`).
- Confirm the **sandbox** environment and validate there before production. Never test against a
  live account. `TODO(verify)` exactly how sandbox vs. production credentials/endpoints differ, or
  ask the user.
- The app's runtime auth is per-install via the token flow — there is **no login** the developer or
  user creates. Registration just provisions the app's identity/keys.

## 3. Environment & secrets

Env is validated by `lib/env.ts` (Zod — the schema pattern is a `javascript-nextjs` concern). ACME
uses the **same four vars as every platform** — and, unlike Peek, needs **no `gatewayKey`/`mode`**
(`AcmeAccessService` authenticates on the app JWT alone):

| Var | What | Notes |
| --- | --- | --- |
| `PEEK_APP_SECRET` | Shared secret for verifying the peek-auth JWT | **Secret** — never commit. Must be the same app whose tokens you verify |
| `PEEK_APP_ID` | The app's ID / issuer | Must pair with the matching `PEEK_APP_SECRET` — same app |
| `PEEK_APP_URL` | The app's own public base URL | Builds the embed redirect target and dev origins |
| `PEEK_API_URL` | Back-office API base | Defaults to the **prod** installations API (`https://app-registry.peeklabs.com/installations-api`). **Sandbox uses a different URL** — must match the environment the app is registered in |

> These four are not independent knobs — they must all describe the **same app in the same
> environment** (prod *or* sandbox). A prod secret with a sandbox API, or a test-app id verifying
> prod tokens, 401s every request.

**Any var the app adds is required too.** As a build introduces persistence or integrations
(`DATABASE_URL`, a webhook signing secret, third-party keys), register each in `lib/env.ts`'s Zod
schema so it's validated on boot, and add it to the production set. A var set locally but missing on
the host is the most common post-deploy failure (the app 500s on first request).

**Secret hygiene:** secrets live in your **host's secret store** (Vercel Environment Variables by
default) — never in the repo or the client bundle. If you add Neon, keep the **`DATABASE_URL`
server-only**. No PII or tokens in logs.

## 4. Deployment — Vercel (recommended default)

Next.js deploys to **Vercel** with zero Docker config. Connect the repo, set the env vars (§3, plus
Neon `DATABASE_URL` if used), and Vercel auto-detects the build. Keep `.github/workflows/ci.yml`
green (lint → typecheck → test w/ coverage → build). Any Node-capable host works.

**First-time deploy checklist:**
- [ ] Development Hub access; **prod** app registered → its `PEEK_APP_ID` + `PEEK_APP_SECRET` (the
      prod app's, not the dev/test app's).
- [ ] Vercel project created and connected to the repo.
- [ ] `PEEK_APP_URL` set to the deployed URL; **`app.acme.json`** `base_url` matches it.
- [ ] Host env is one **coherent prod set**: `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_APP_URL`, and
      `PEEK_API_URL` (prod default — don't carry over the sandbox URL); Neon `DATABASE_URL` if used.
- [ ] Register the embed URL (`<base_url>/examples/acme/main`) and the install-status webhook (and
      any MCP URL) in the Hub / `app.acme.json`; validate in **sandbox** first.
- [ ] Confirm the embed loads in the iframe (CSP `frame-ancestors` set in `next.config.ts`).

## Related skills

- **`manifest-and-deploy`** (global) — the generic manifest→registry, 2-env-401, env-coherence
  concept behind this skill.
- **`javascript-nextjs`** (stack) — the Next build on Vercel and the `lib/env.ts` Zod pattern.
- **`acme-embed-and-auth`** — the embed route the manifest points at; how `PEEK_APP_SECRET` is used.
- **`acme-backoffice-api`** — the `acme_backoffice_api@v1` extendable grants this API access;
  `installDataId` scoping for any DB.
- **`acme-webhooks`** / **`acme-mcp-endpoint`** — the install-status webhook and (optional) MCP
  endpoint URLs declared in the manifest/registry.
- **`peek-manifest-and-deploy`** — the same story on Peek (which adds `gatewayKey`/`mode` and the
  Neon-vs-Supabase rationale in full).
