---
name: peek-app-builder
description: >-
  Entry point and guided workflow for building an app on this Peek Pro starter kit (a Next.js
  app that embeds inside Peek Pro's back-office iframe). Use when the user wants to build a
  Peek Pro app or add a feature to one — waitlist, abandoned-booking recovery, dynamic pricing,
  custom checkout, reseller/channel sync, reporting, webhook handling, or anything Peek Pro
  lacks natively. Owns the discover → mock → plan → sign-off → build → validate flow and
  delegates the specifics to the peek-embed-and-auth, peek-backoffice-api, peek-webhooks,
  peek-mcp-endpoint, odyssey-ui, peek-app-manifest-and-deploy, and testing-peek-apps skills.
  Triggers on "Peek Pro app", "PeekPro", "Peek app", "Peek booking", "Peek integration",
  "build on the starter kit".
---

# Build a Peek Pro app (on this starter kit)

You are helping the user build an **app that extends Peek Pro** — a tours & activities booking
platform — using **this repository**, an opinionated Next.js starter kit that already ships the
hard parts (iframe embed, the auth pipeline, the Peek SDK client, Odyssey UI, tests, CI). Your
job is to **extend what's here**, not rebuild it from scratch.

Peek Pro is **sparsely documented**, so do not rely on model memory for Peek specifics. These
skills carry the canonical knowledge and tell you when to look things up live.

## The core stack is already decided — don't re-litigate it

Unlike a greenfield build, you do **not** choose the language, framework, or SDK. This kit is
**Next.js 16 + React 19 + Tailwind 4 + TypeScript (App Router)**, tests with **Vitest**, and
talks to Peek through the **`@peektravel/app-utilities`** package (`PeekAccessService`,
Node-only — the first-class SDK). Take these as given.

**Host and database are still your choice** (the "moving layer" — see below). The recommended
default is **Vercel** for hosting and **Neon (serverless Postgres)** for data when you need it,
accessed **server-side only** (a `DATABASE_URL`), with live UI via polling/SSE from your own API
routes — offer it as a recommendation, not a mandate. Phase 0 ships **no database** (persistence
is deliberately deferred), so most first apps don't need one yet. See
`peek-app-manifest-and-deploy` for the deploy/secrets specifics — including **why Supabase is a
poor fit here** (its auth/RLS model doesn't match Peek's token).

> ⚠️ The repo currently includes **Fly.io / Docker** files (`Dockerfile`, `fly.toml`,
> `fly-deploy.yml`) — these are **placeholder scaffolding scheduled for removal**, not the
> recommended target. Don't steer the user to Fly; recommend Vercel.

> **Read AGENTS.md first.** This Next.js version has breaking changes vs. training data, and
> the iframe/SPA architecture has hard constraints (no cookies, no SSR data fetching,
> library-owned auth). Everything below assumes those rules.

## This skill reconciles three layers of knowledge

Your real job is **synthesis**. Three sources of truth meet at build time:

1. **Fixed layer — the sibling skills.** How Peek apps work: the embed/auth handshake, data
   scoping, webhooks, the SDK, Odyssey, deploy. Stable; trust these skills.
2. **Moving layer — live web search.** Current best practices for Next.js 16 / React 19 / your
   host (Vercel by default) — this ages fast, so research it fresh (and read
   `node_modules/next/dist/docs/` for the framework APIs, per AGENTS.md).
3. **Peek specifics — the installed `@peektravel/app-utilities` package.** For Peek's concrete
   facts — the SDK surface, webhook parsers, Odyssey components, install/settings contract —
   **read the package itself.** It's the authoritative, version-matched source:
   - **`node_modules/@peektravel/app-utilities/dist/index.d.ts`** — every public method/type,
     fully typed with TSDoc and exact return shapes (the SDK surface; see `peek-backoffice-api`).
   - **`node_modules/@peektravel/app-utilities/docs/`** — the shipped guides, e.g. `docs/ui.md`
     (Odyssey), `docs/webhooks.md` (webhook config + parsers). (Same files are mirrored on
     jsdelivr if you need them without installing.)

   **This is the primary research step for anything Peek-specific — inspect the package first.**
   If a fact genuinely isn't in the types or `docs/`, mark it **`TODO(verify)`**, check the live
   web doc, and/or **ask the user** — never silently fill the gap with a guess.

> **The app you're building serves its own MCP endpoint by default** — a runtime surface so the
> App Store's AI orchestrator can operate it without the UI (see `peek-mcp-endpoint`). That's the
> app exposing *itself*; Peek's own facts still come from the installed package (above).

## How to interact (every step)

- **Always ask when something is unclear — never guess or assume** the goal, scope, a Peek
  detail, or the right approach.
- **Ask one question at a time.** Pose a single question with your recommendation, let the
  user chat it through, and only then move on. Don't batch questions.

## The workflow

**Kickoff:** give the user a short bulleted overview of these steps and ask if they want to do
anything differently (skip, reorder, re-emphasize). Then begin.

| Step | What it covers | Lean on |
| --- | --- | --- |
| 1. **Discover purpose** | What gap in Peek Pro does this fill? Who uses it (account staff / guests / app admin)? What triggers it (a webhook, a schedule, a user action)? What Peek data does it read/change? Tight v1 scope. **Explicitly raise the MCP endpoint here** (built by default): tell the user, **recommend a concrete tool list** derived from the app's jobs, and let them confirm/trim/opt out. Also **flag any stack risk** that could break the endpoint. | `peek-backoffice-api`, `peek-webhooks` for what's possible; `peek-mcp-endpoint` for what to expose |
| 2. **Mock the UI** | Build an interactive single-file `index.html` Odyssey mockup, iterate until the user is happy. | `odyssey-ui` |
| 3. **Plan** | Map the **data flow** as rigorously as the UI (source → when → storage → **verified available?**), pick which webhooks vs. SDK calls, note `installDataId` scoping if persistence is added. Write it up using `plan-template.md`. | all platform skills + the installed package (types + `docs/`) + web |
| 4. **Sign-off (hard gate)** | Present the plan; get an explicit "yes, build this." Call out anything you **couldn't verify in the package/docs** (`TODO(verify)`). **Do not build before this.** | — |
| 5. **Build** | Implement per the plan: new authenticated routes + client fetches, webhook endpoints, the **MCP endpoint (by default)**, Odyssey UI, tests as you go. | `peek-embed-and-auth`, `peek-backoffice-api`, `peek-webhooks`, `peek-mcp-endpoint`, `odyssey-ui`, `testing-peek-apps` |
| 6. **Validate & ship** | Run lint/typecheck/tests + coverage; **have the user run the app under the Peek framework** (local tunnel or deploy — see below) so the embed actually loads; confirm secrets/PII handling; **hand the user their production env-var checklist** (see below); register in the Development Hub and deploy. | `testing-peek-apps`, `peek-app-manifest-and-deploy` |

Don't skip discovery/mockup, and **don't build before sign-off (step 4)**.

## Running the app — `next dev` won't work; it needs the Peek framework

This app **cannot be run or exercised with the standard Next.js toolchain** — `next dev`, a
plain `localhost:3000`, a preview server, or any generic emulator. Those load the app *outside*
Peek, where it has no iframe host, no parent frame to `postMessage` a token from, and no App
Store registration — so the token gate never resolves and every authenticated route 401s. A
green `next dev` proves nothing here; **don't rely on it to validate behavior, and don't tell
the user the app "works" because a dev server started.**

You (the agent) also **can't run the real thing yourself** — it requires the user's Peek
credentials and an App-Store-registered tunnel. So when it's time to see the app actually run,
**stop and hand off to the user** with one of two paths:

- **Run it locally** — the user runs:
  ```bash
  npx @peektravel/app-cli dev
  ```
  This spins up a **local tunnel and registers that tunnel with the App Store**, so Peek can
  embed the local app in the real iframe with real auth. This is the correct "dev server" for
  this kit — not `next dev`.
- **Deploy it** — ship to the host (Vercel by default) and exercise it as an installed app.
  See `peek-app-manifest-and-deploy`.

What you *can* do without the framework: lint, typecheck, and the Vitest suite (auth logic,
webhook derivation, ID normalization, tool dispatch — see `testing-peek-apps`). Drive those
yourself, but for "does it actually run in the embed," **notify the user to run
`npx @peektravel/app-cli dev` or deploy** — that's their step, not yours.

## Before deploy: hand the user their production env-var checklist

Ending a build **must** include an explicit, copy-pasteable list of the environment variables
the app needs in production — the single most common "the app 401s / won't boot after deploy"
cause is a var that's set locally but never added to the host. Don't assume the user knows which
ones; `lib/env.ts` fails **loud at runtime** if any required var is missing (see the misconfig
→ 500 guidance in `peek-embed-and-auth`), so a forgotten var is a broken deploy, not a warning.

**The list is dynamic — don't just parrot the base four.** Derive it at the end of *this* build:

1. Start with the kit's required runtime vars: **`PEEK_APP_SECRET`**, **`PEEK_APP_ID`**,
   **`PEEK_APP_URL`**, and **`PEEK_API_URL`** (only if you overrode the default).
2. Add **every var this build introduced** — grep the code you wrote for `process.env.` and read
   `lib/env.ts`. Anything you added there (a `DATABASE_URL` for Neon, a third-party API key, a
   webhook signing secret, an SSE/queue URL) belongs on the list. **Any new runtime var must be
   registered in `lib/env.ts`'s Zod schema** so it's validated on boot — if it's read from
   `process.env` but not in the schema, add it, then include it here.
3. Mark each as **secret** (host secret store only, never committed — `PEEK_APP_SECRET`,
   `DATABASE_URL`, API keys) or **non-secret config** (`PEEK_APP_ID`, `PEEK_APP_URL`).

Then present it verbatim, e.g.:

> **Before you deploy, set these in your host (Vercel → Settings → Environment Variables):**
> - `PEEK_APP_SECRET` — secret (from the Development Hub)
> - `PEEK_APP_ID` — config (from the Development Hub)
> - `PEEK_APP_URL` — config (your deployed base URL; must match `app.json` `base_url`)
> - `PEEK_API_URL` — config (only if overriding the default)
> - `DATABASE_URL` — secret (Neon; server-only) *(only if this build added persistence)*
> - …any other var this build introduced
>
> The app validates these on boot and will 500 on the first request if any required one is
> missing — so set them **before** you flip traffic to the deploy.

See `peek-app-manifest-and-deploy` §3 for the canonical var table and the first-time-deploy
checklist; this step makes sure the *actual* set for the app you just built reaches the user.

## Hard rules (do not violate)

- **Never build your own login for the embedded surface.** Identity comes from Peek via the
  peek-auth token. See `peek-embed-and-auth`. (A separate developer/admin surface *may* have
  its own auth.)
- **In any Node/server-side code, reach the Peek Pro API only through `@peektravel/app-utilities`
  (`PeekAccessService`) — never a raw HTTP/GraphQL call, and never hand-write GraphQL.** See
  `peek-backoffice-api`.
- **Expose the app's key functionality as an MCP endpoint by default** so the App Store AI
  orchestrator can drive it without the UI. At first build, **raise it explicitly and recommend a
  concrete tool list** (don't build or skip it silently); reuse the *same* auth as the UI; curate
  with the user (reads by default, gate writes); **flag stack risks** that could break it (Node vs
  Edge runtime, streaming vs serverless limits, stateless sessions). See `peek-mcp-endpoint`. Skip
  only if the user says the app shouldn't be AI-addressable. **When you later add a feature, keep
  the MCP tools in sync** (also in `AGENTS.md`).
- **Treat Peek data as sensitive PII.** Security-first storage/logging/transit; no PII or
  tokens in logs.
- **Scope persisted data to an `installDataId`** if/when you add a database (the install ID is
  stable across reinstalls). See `peek-backoffice-api`.
- **Don't invent Peek endpoint/schema/event details.** Resolve them from the installed
  `@peektravel/app-utilities` package (types in `dist/index.d.ts` + `docs/`); if a fact isn't
  there, mark `TODO(verify)`, check the live doc, and/or ask the user — never guess.
- **Plan the data flow, not just the UI — and verify each field actually exists** before
  building. An app built on absent data won't work.
- **Ship with tests.** Keep the Vitest suite green and meaningful (see `testing-peek-apps`).
- **End every build with the production env-var checklist.** List the exact vars this app needs
  (base four + anything the build added), flag secret vs config, and tell the user to set them in
  the host **before** deploying. Register any new var in `lib/env.ts`. See "Before deploy" above.
- **Never run/validate the app with `next dev` or a generic emulator.** It needs the Peek
  framework (iframe host + parent-frame token + App Store registration). To see it actually run,
  **notify the user to run `npx @peektravel/app-cli dev`** (local tunnel registered with the App
  Store) **or deploy** — you can't run the real embed yourself. See "Running the app" above.
- **When unclear, ask — one question at a time.**

## Artifacts in this folder

- `plan-template.md` — the structure for the step-3 plan. Copy it into the user's project (e.g.
  `PLAN.md`) and fill it in.

## Related skills

`peek-embed-and-auth` · `peek-backoffice-api` · `peek-webhooks` · `peek-mcp-endpoint` ·
`odyssey-ui` · `peek-app-manifest-and-deploy` · `testing-peek-apps`
