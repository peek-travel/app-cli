---
name: app-builder
description: >-
  Entry point and guided workflow for building an app that extends a booking/commerce platform
  on this CLI's starter kit — an app that embeds inside the platform's back-office surface. Use
  when the user wants to build a platform app or add a feature to one — waitlist, abandoned-booking
  recovery, dynamic pricing, custom checkout, reseller/channel sync, reporting, webhook handling,
  or anything the platform lacks natively. Owns the discover → mock → plan → sign-off → build →
  validate flow and delegates the specifics to the embed-and-auth, backoffice-data, webhooks,
  mcp-endpoint, manifest-and-deploy, and testing skills (plus your platform's and stack's skills).
  Triggers on "build a platform app", "extend the platform", "add a feature to the app",
  "build on the starter kit".
---

# Build a platform app (on this starter kit)

You are helping the user build an **app that extends a booking/commerce platform** using
**this repository** — an opinionated starter kit that already ships the hard parts (the embed,
the auth pipeline, the platform SDK client, the UI kit, tests, CI). Your job is to **extend
what's here**, not rebuild it from scratch.

These platforms are typically **sparsely documented**, so do not rely on model memory for
platform specifics. These skills carry the durable knowledge and tell you when to look things
up live in the installed SDK. **Peek Pro is the canonical example throughout** — where a rule
names a Peek mechanism, that mechanism lives in your platform's skills; the concept is the same
on any platform.

## The platform and stack are already chosen — don't re-litigate them

Unlike a greenfield build, you do **not** pick the language, framework, or SDK here. **The CLI
selected a platform (e.g. `peek`, `cng`, `acme`) and a stack (e.g. `javascript`) when it
scaffolded this kit; take both as given.** The concrete facts that flow from those choices —
which SDK package, which framework, which test runner, which auth token — live in **your
platform's skills** (`<platform>-*`) and **your stack's skills** (`<stack>-*`), not here. This
skill is platform- and stack-neutral and links down to them.

**Host and database remain your choice** (the "moving layer" — see below). Reach for persistence
only when the app genuinely needs it; a first build often ships none. When it does, prefer a
serverless-Postgres-style database reached **server-side only**, with any live UI driven by
polling/SSE from your own API routes — offer it as a recommendation, not a mandate. The concrete
host/DB recommendation lives in `manifest-and-deploy` and your platform/stack skills.

## This skill reconciles three layers of knowledge

Your real job is **synthesis**. Three sources of truth meet at build time:

1. **Fixed layer — the sibling skills.** How apps like this work: the embed/auth handshake, data
   scoping, webhooks, the SDK, the UI kit, deploy. Stable; trust these skills (the generic ones
   here, plus your platform's and stack's).
2. **Moving layer — live web search.** Current best practices for your framework and host — this
   ages fast, so research it fresh at build time rather than trusting memory.
3. **Platform specifics — the installed platform SDK package.** For the platform's concrete facts
   — the SDK surface, webhook parsers, UI components, install/settings contract — **read the
   installed package itself.** It is the authoritative, version-matched source: its shipped type
   definitions (the fully-typed method/return surface) and its shipped `docs/`. **This is the
   primary research step for anything platform-specific — inspect the package first.** How to
   introspect it is your stack's concern (see `javascript-app-utilities` on the JS stack).

   If a fact genuinely isn't in the types or `docs/`, mark it **`TODO(verify)`**, check the live
   web doc, and/or **ask the user** — never silently fill the gap with a guess.

> **The app you're building serves its own MCP endpoint by default** — a runtime surface so the
> app store's AI orchestrator can operate it without the UI (see `mcp-endpoint`). That's the app
> exposing *itself*; the platform's own facts still come from the installed package (above).

## The capability gate — verify each capability exists for the SELECTED platform

**The platform SDK's capabilities differ per platform and evolve per version.** The same package
name can expose a different surface on `peek` than on `cng` or `acme`, and a newer version can add
or remove methods. An approach that's trivial on one platform may be **impossible** on another —
for example, a raw GraphQL escape-hatch exists on peek but **not** on cng/acme, where the typed
SDK is the hard ceiling.

So during **discover** and **plan**, before you lock anything: **verify each capability the plan
needs actually exists in the installed SDK for the selected platform.** Don't assume from memory
that a method, resource, or field is available — introspect the installed package and confirm.

- **How to introspect** the installed package (read its types + docs, confirm a current version,
  enumerate the client's methods): your stack's SDK skill — `javascript-app-utilities` on the JS
  stack.
- **The capability boundary** for your platform (which client it exposes, what it *can't* do,
  whether a GraphQL-style escape-hatch exists): your platform's back-office skill —
  `peek-backoffice-api` is the canonical example.
- **Which registry extensions the app can declare** for the selected platform (the settings/embed
  URL, install/uninstall webhook, per-event booking webhooks): the CLI — `npx @peektravel/app-cli
  extensions list --platform <platform>`. If a feature depends on an extension not listed for the
  platform, it can't ship — flag it. See **`cli`**.

Any needed capability you can't confirm in the installed SDK is a `TODO(verify)` that **must** be
resolved before sign-off — find the real capability or change the design. A plan built on a
capability the selected platform doesn't have won't ship.

## How to interact (every step)

- **Always ask when something is unclear — never guess or assume** the goal, scope, a platform
  detail, or the right approach.
- **Ask one question at a time.** Pose a single question with your recommendation, let the user
  chat it through, and only then move on. Don't batch questions.

## The workflow

**Kickoff:** give the user a short bulleted overview of these steps and ask if they want to do
anything differently (skip, reorder, re-emphasize). Then begin.

| Step | What it covers | Lean on |
| --- | --- | --- |
| 1. **Discover purpose** | What gap does this fill? Who uses it (account staff / guests / app admin)? What triggers it (a webhook, a schedule, a user action)? What platform data does it read/change? Tight v1 scope. **Explicitly raise the MCP endpoint here** (built by default): tell the user, **recommend a concrete tool list** derived from the app's jobs, and let them confirm/trim/opt out. Also **flag any stack risk** that could break the endpoint. Start the **capability gate**: sanity-check that the platform data/actions you'll need exist for the selected platform. **Decide the PII posture here too:** the SDK omits customer PII **by default** (`fullCustomerAccess: false`), so treat pulling PII as an opt-in you must justify. If the app only needs aggregate/operational signal (demand over time, occupancy, revenue trends), **recommend keeping the default** — and reach for `fullCustomerAccess: true` only when a concrete feature needs to contact customers or move money (see the PII hard rule below). | `backoffice-data`, `webhooks` for what's possible; `mcp-endpoint` for what to expose; your platform's + stack's skills for the concrete surface |
| 2. **Mock the UI** | Build an interactive single-file `index.html` mockup with the platform's UI kit, iterate until the user is happy. | your stack's UI skill (e.g. `javascript-odyssey-ui`) |
| 3. **Plan** | Map the **data flow** as rigorously as the UI (source → when → storage → **verified available in the installed SDK?**), pick which webhooks vs. SDK calls, note per-install data scoping if persistence is added. Close the capability gate: every needed capability confirmed present for the selected platform. Write it up using `plan-template.md`. | all the generic skills + your platform's + stack's skills + the installed package + web |
| 4. **Sign-off (hard gate)** | Present the plan; get an explicit "yes, build this." Call out anything you **couldn't verify** (`TODO(verify)`). **Do not build before this.** | — |
| 5. **Build** | Implement per the plan: new authenticated routes + client fetches, webhook endpoints, the **MCP endpoint (by default)**, UI, tests as you go. | `embed-and-auth`, `backoffice-data`, `webhooks`, `mcp-endpoint`, `testing` + your platform's + stack's skills |
| 6. **Validate & ship** | Run lint/typecheck/tests + coverage; **have the user run the app under the platform framework** (local tunnel or deploy — see below) so the embed actually loads; confirm secrets/PII handling; **hand the user their production env-var checklist** (see below); register in the platform's developer hub and deploy. | `cli` (run locally via `dev`), `testing`, `manifest-and-deploy` |

Don't skip discovery/mockup, and **don't build before sign-off (step 4)**.

## Running the app — a plain dev server won't work; it needs the platform framework

This app **cannot be run or exercised with the plain framework toolchain** — a plain
`localhost`, a preview server, or any generic emulator. Those load the app *outside* the
platform, where it has no host frame to hand it a token and no app-store registration — so the
token gate never resolves and every authenticated route 401s. A green dev-server boot proves
nothing here; **don't rely on it to validate behavior, and don't tell the user the app "works"
because a dev server started.**

You (the agent) also **can't run the real thing yourself** — it requires the user's platform
credentials and an app-store-registered tunnel. So when it's time to see the app actually run,
**stop and hand off to the user** with one of two paths:

- **Run it locally** — the user runs this CLI's dev command:
  ```bash
  npx @peektravel/app-cli dev
  ```
  This spins up a **local tunnel and registers it with the app store**, so the platform can embed
  the local app in the real host frame with real auth. This is the correct "dev server" for this
  kit — not the plain framework dev server. See **`cli`** for the full CLI (the preflight checks —
  is it on production? is the user logged in? — and what `dev` does to the manifest).
- **Deploy it** — ship to the host and exercise it as an installed app. See `manifest-and-deploy`.

What you *can* do without the framework: lint, typecheck, and the test suite (auth logic, webhook
derivation, ID normalization, tool dispatch — see `testing`). Drive those yourself, but for "does
it actually run in the embed," **notify the user to run the CLI dev command or deploy** — that's
their step, not yours.

## Before deploy: hand the user their production env-var checklist

Ending a build **must** include an explicit, copy-pasteable list of the environment variables the
app needs in production — the single most common "the app 401s / won't boot after deploy" cause is
a var that's set locally but never added to the host. Don't assume the user knows which ones; the
kit's env validation fails **loud at runtime** if any required var is missing (see the misconfig →
500 guidance in `embed-and-auth`), so a forgotten var is a broken deploy, not a warning.

**The list is dynamic — don't just parrot the base vars.** Derive it at the end of *this* build:

1. Start with the kit's required runtime vars — the platform app id, the app secret, the app's
   public base URL, and the platform API base (see your platform's `*-manifest-and-deploy` for the
   exact names).
2. Add **every var this build introduced** — grep the code you wrote for env reads and read the
   kit's env module. Anything you added (a `DATABASE_URL`, a third-party API key, a webhook signing
   secret, an SSE/queue URL) belongs on the list. **Any new runtime var must be registered in the
   env schema** so it's validated on boot — if it's read from the environment but not in the schema,
   add it, then include it here.
3. Mark each as **secret** (host secret store only, never committed — the app secret, DB URLs, API
   keys) or **non-secret config** (the app id, the base URL).

Then present it verbatim, e.g.:

> **Before you deploy, set these in your host's environment settings:**
> - `<APP_SECRET>` — secret (from the developer hub)
> - `<APP_ID>` — config (from the developer hub)
> - `<APP_URL>` — config (your deployed base URL; must match the manifest's base URL)
> - `<API_URL>` — config (only if overriding the default)
> - `DATABASE_URL` — secret (server-only) *(only if this build added persistence)*
> - …any other var this build introduced
>
> The app validates these on boot and will 500 on the first request if any required one is
> missing — so set them **before** you flip traffic to the deploy.

See `manifest-and-deploy` for the coherent-env rules and your platform's `*-manifest-and-deploy`
for the canonical var table; this step makes sure the *actual* set for the app you just built
reaches the user.

## Hard rules (do not violate)

- **Never build your own login for the embedded surface.** Identity comes from the platform via
  the host-delivered token. See `embed-and-auth`. (A separate developer/admin surface *may* have
  its own auth.)
- **In any server-side code, reach the platform's back-office API only through its official
  SDK — never a raw HTTP/GraphQL call, and never hand-write GraphQL against a live account.**
  See `backoffice-data`.
- **Verify each needed capability exists in the installed SDK for the selected platform before
  locking the plan.** Capabilities are platform- and version-specific; an approach trivial on one
  platform can be impossible on another. See "The capability gate" above.
- **Expose the app's key functionality as an MCP endpoint by default** so the store's AI
  orchestrator can drive it without the UI. At first build, **raise it explicitly and recommend a
  concrete tool list** (don't build or skip it silently); reuse the *same* auth as the UI; curate
  with the user (reads by default, gate writes); **flag stack risks** that could break it (server
  vs. edge runtime, streaming vs. serverless limits, stateless sessions). See `mcp-endpoint`. Skip
  only if the user says the app shouldn't be AI-addressable. **When you later add a feature, keep
  the MCP tools in sync.**
- **Treat platform data as sensitive PII.** Security-first storage/logging/transit; no PII or
  tokens in logs. **And don't pull PII you don't need — PII is OFF by default.** The SDK
  (`@peektravel/app-utilities` 0.5.1+) takes `accessOptions: { fullCustomerAccess }` once at client
  construction; it **defaults to `false`**, which redacts customer identity and disables
  payment/booking-modification ops. **Make an explicit recommendation to the user at design time:**
  keep the default whenever the app's job is aggregate/operational (demand, occupancy, revenue
  trends) and only set `fullCustomerAccess: true` when a concrete feature must contact customers or
  move money — and only if the install is entitled. See `backoffice-data`, and `peek-backoffice-api`
  for the concrete Peek redaction behavior and blocked operations.
- **Scope persisted data to a stable per-install data key** if/when you add a database. See
  `backoffice-data`.
- **Don't invent platform endpoint/schema/event details.** Resolve them from the installed SDK
  package (types + `docs/`); if a fact isn't there, mark `TODO(verify)`, check the live doc, and/or
  ask the user — never guess.
- **Plan the data flow, not just the UI — and verify each field actually exists** before building.
  An app built on absent data won't work.
- **Ship with tests.** Keep the suite green and meaningful (see `testing`).
- **End every build with the production env-var checklist.** List the exact vars this app needs
  (base vars + anything the build added), flag secret vs config, and tell the user to set them in
  the host **before** deploying. Register any new var in the env schema. See "Before deploy" above.
- **Never run/validate the app with the plain framework dev server or a generic emulator.** It
  needs the platform framework (host frame + parent-frame token + app-store registration). To see
  it actually run, **notify the user to run the CLI dev command** (local tunnel registered with the
  app store) **or deploy** — you can't run the real embed yourself. See "Running the app" above.
- **When unclear, ask — one question at a time.**

## Artifacts in this folder

- `plan-template.md` — the structure for the step-3 plan. Copy it into the user's project (e.g.
  `PLAN.md`) and fill it in.

## Related skills

Generic: `cli` · `embed-and-auth` · `backoffice-data` · `webhooks` · `mcp-endpoint` ·
`manifest-and-deploy` · `testing`. Then link down to **your platform's** skills (the canonical
example set: `peek-embed-and-auth`, `peek-backoffice-api`, `peek-pricing`, `peek-webhooks`,
`peek-mcp-endpoint`, `peek-manifest-and-deploy`) and **your stack's** skills (on JS: `javascript-app-utilities`,
`javascript-odyssey-ui`, `javascript-nextjs`, `javascript-typings`, `javascript-testing`).
