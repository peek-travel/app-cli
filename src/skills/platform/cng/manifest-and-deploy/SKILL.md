---
name: cng-manifest-and-deploy
description: >-
  The concrete Connect&GO (cng) manifest, registration, and deploy — how to register, configure,
  and ship a starter-kit app to a cng account. Covers the app.json manifest (extendables keyed by
  platform: the cng_backoffice_api@v1 platform extendable, the app_registry_settings_url that is
  the embed URL cng POSTs to, the install-status webhook registration), what app.json does NOT
  hold (slug, base_url, listing copy), the .peek-kit.json project file, the two-app/two-environment split and the #1 source of 401s, the shared PEEK_APP_SECRET / PEEK_APP_ID /
  PEEK_APP_URL / PEEK_API_URL env contract (no gatewayKey/mode for cng), and the Vercel + Neon
  hosting default. Use when editing app.json, setting up env/secrets, registering the app,
  changing embed/webhook URLs, or deploying. Triggers on "app.json", "app.cng.json", "cng
  manifest", ".peek-kit.json", "use-url", "cng_backoffice_api", "deploy cng app", "env vars",
  "register the cng app", "sandbox vs prod", "401 after deploy".
---

# Connect&GO (cng) manifest, registration & deployment

This is the **concrete cng mechanism** for shipping an app. The generic concept — a manifest
declares the app to the platform's registry; keep one coherent `{id, secret, api, base_url}` set
per environment or every request 401s; hand the user a complete env checklist — lives in
`manifest-and-deploy`. Read that for the *why*; this skill is the authoritative *how it works on
cng*.

Getting an app from this starter kit into a cng account has three parts: the **manifest**
(`app.json`), **registration** in the Development Hub, and **deployment** to your host.

> **Hosting is your choice — this skill recommends a default.** Language/framework/SDK are fixed by
> the kit (`javascript-nextjs`); the **host and database are the "moving layer."** Recommended
> default: **Vercel** (hosting) + **Neon serverless Postgres** (data, when you add persistence),
> accessed **server-side only**. Any Node-capable host/DB works. (Why Neon and not Supabase — the
> peek reasoning applies unchanged: this kit authenticates with Peek's symmetrically-signed token,
> not a Supabase-signed JWT, so Supabase's RLS/auth differentiators go unused. See
> `peek-manifest-and-deploy`.)

## 1. The manifest — `app.json`

`app.json` declares **what the app plugs into**, and nothing else. It is a flat object of
extendables keyed by who consumes them — `registry` plus one key per platform. (The starter kit
ships one per platform, `app.cng.json`; `peek init` materializes the one you picked as
`app.json`.)

```json
{
  "registry": [
    { "slug": "app_registry_settings_url@v1",
      "configuration": { "url": "/examples/cng/main", "url_mode": "prepend_base_url" } },
    { "slug": "app_registry_webhook@v1",
      "configuration": { "url": "/examples/webhooks/install-status" } }
  ],
  "cng": [
    { "slug": "cng_backoffice_api@v1",
      "configuration": { "permissions": ["products:read"] } }
  ],
  "peek": null,
  "acme": null
}
```

- **`cng`** — the platform capabilities the app requests. This kit ships
  **`cng_backoffice_api@v1`** with `configuration.permissions: ["products:read"]` — that's what
  grants access to the cng back-office API used via `CngAccessService` (see `cng-backoffice-api`).
  Widen the `permissions` array only as far as the app actually needs. The key holding a **list**
  is what makes the app run on cng: platform support is *derived* from these keys, `null` means
  "not on that platform", and a key you **leave out** means "leave that platform as it is."
- **`registry`** — how cng surfaces the app:
  - **`app_registry_settings_url@v1`** with `url: "/examples/cng/main"` and
    `url_mode: "prepend_base_url"` — cng loads `<base_url>/examples/cng/main` (the embed entry
    route) inside the iframe. **This URL is what cng POSTs to** — it must match the embed route
    (see `cng-embed-and-auth`).
  - **`app_registry_webhook@v1`** with `url: "/examples/webhooks/install-status"` — registers the
    install-status webhook endpoint (see `cng-webhooks`).

**Three things are NOT in app.json, and putting them back breaks the push (unknown top-level keys
are rejected with a 400):**

| Not in the manifest | Where it lives |
| --- | --- |
| The app's **slug** | `.peek-kit.json` (`app.id`), and in the URL the CLI pushes to — which is what lets one manifest be pushed at your real app *and* at its test app. |
| **`base_url`** | Set per environment: `peek dev` points the test app at the tunnel, `peek use-url <url>` points an app at a deployed host. |
| **Name, description, icon, screenshots, categories** | A per-platform **listing**, written and reviewed in the portal (*Apps → your app → Distribution*). |

> When you change the embed path or add/point a webhook or MCP endpoint, update `app.json` and push
> it (`peek sync-app`); `peek dev` pushes it for you on every restart.

> **Slug note:** the manifest requests the extendable as `cng_backoffice_api@v1`. Internally the
> SDK routes REST calls through the gateway path segment `cng_backoffice_api-v1` — you don't set
> that (the `CngAccessService` does); just don't be surprised the two forms differ.

## The two-app / two-environment split — the #1 source of 401s

You are really juggling **two separate apps** — one manifest, pushed at two slugs — and mixing
their identities is the most common cause of "every request 401s / blank iframe." The same
discipline as Peek applies:

| | **Source / production app** | **Dev / test app** |
| --- | --- | --- |
| Slug | your real slug, `.peek-kit.json` `app.id` | the test slug the registry derives, `app.testId` |
| Manifest | `app.json` — the **same file** is pushed at both | same `app.json` |
| `base_url` | your deployed URL, set with `peek use-url <url> --prod` | the ephemeral tunnel URL, re-set on each `peek dev` run |
| Installations API | **prod** (`PEEK_API_URL` default) | **sandbox** |
| id + secret live in | the **host's** env, set at deploy | `.env.local` (written by the dev CLI) |

**Two invariants — break either and every request 401s:**

1. **`PEEK_APP_ID` / `PEEK_APP_SECRET` must belong to the same app whose tokens you verify.** The
   peek-auth token is signed with the *issuing app's* secret; your runtime verifies it with
   `PEEK_APP_SECRET`. If the iframe runs the test app but your env holds the prod app's id+secret
   (or vice versa), **every verify fails → 401.**
2. **`PEEK_API_URL` (sandbox vs prod) must match where the app is registered.** `CngAccessService`
   mints its own API tokens and calls the installations API at `PEEK_API_URL`; point it at the
   wrong environment and the install isn't found / calls fail.

**Rule of thumb: one coherent set at a time.** `{app id, app secret, API URL, base_url}` must all
describe the *same* app in the *same* environment. Don't cross the streams.

## 2. Registration — the Development Hub

- Get access to the **Development Hub**; `TODO(verify)` the Hub URL + cng onboarding steps.
- Register the app; obtain its **app ID** (`PEEK_APP_ID`) and **shared secret** (`PEEK_APP_SECRET`,
  used to verify the peek-auth JWT — see `cng-embed-and-auth`).
- Confirm the **sandbox** environment and validate there before production. Never test against a
  live account. `TODO(verify)` exactly how sandbox vs. production credentials/endpoints differ, or
  ask the user.
- The app's runtime auth is per-install via the token flow — there is **no login** the developer or
  user creates. Registration just provisions the app's identity/keys.

## 3. Environment & secrets

Env is validated by `lib/env.ts` (Zod — the schema pattern is a `javascript-nextjs` concern). cng
uses the **same four vars as every platform** — and, unlike Peek, needs **no `gatewayKey`/`mode`**
(`CngAccessService` authenticates on the app JWT alone):

| Var | What | Notes |
| --- | --- | --- |
| `PEEK_APP_SECRET` | Shared secret for verifying the peek-auth JWT | **Secret** — never commit. Must be the same app whose tokens you verify |
| `PEEK_APP_ID` | The app's ID / issuer | Must pair with the matching `PEEK_APP_SECRET` — same app |
| `PEEK_APP_URL` | The app's own public base URL | Builds the embed redirect target and dev origins |
| `PEEK_API_URL` | Back-office API base | Defaults to the **prod** installations API (`https://apps.peek.com/installations-api`). **Sandbox uses a different URL** — must match the environment the app is registered in |

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
- [ ] `PEEK_APP_URL` set to the deployed URL, and the **prod app** pointed at the same origin:
      `peek use-url https://<your-host> --prod` (that is what sets `base_url` — it is not a field
      in `app.json`).
- [ ] Host env is one **coherent prod set**: `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_APP_URL`, and
      `PEEK_API_URL` (prod default — don't carry over the sandbox URL); Neon `DATABASE_URL` if used.
- [ ] Declare the embed URL (`<base_url>/examples/cng/main`) and the install-status webhook (and any
      MCP URL) in `app.json` and push it (`peek sync-app`); validate in **sandbox** first.
- [ ] Write the **listing** (name, description, icon, screenshots) in the portal under
      *Apps → your app → Distribution* — none of it comes from `app.json`.
- [ ] Confirm the embed loads in the iframe (CSP `frame-ancestors` set in `next.config.ts`).

## Related skills

- **`manifest-and-deploy`** (global) — the generic manifest→registry, 2-env-401, env-coherence
  concept behind this skill.
- **`javascript-nextjs`** (stack) — the Next build on Vercel and the `lib/env.ts` Zod pattern.
- **`cng-embed-and-auth`** — the embed route the manifest points at; how `PEEK_APP_SECRET` is used.
- **`cng-backoffice-api`** — the `cng_backoffice_api@v1` extendable grants this API access;
  `installDataId` scoping for any DB.
- **`cng-webhooks`** / **`cng-mcp-endpoint`** — the install-status webhook and (optional) MCP
  endpoint URLs declared in the manifest/registry.
- **`peek-manifest-and-deploy`** — the same story on Peek (which adds `gatewayKey`/`mode` and the
  Neon-vs-Supabase rationale in full).
