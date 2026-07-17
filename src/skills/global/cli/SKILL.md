---
name: cli
description: >-
  The Peek app CLI (@peektravel/app-cli) — the tool that connects your local app to the app
  registry: discovering commands, checking which registry you're on (production vs sandbox) and
  who you're logged in as, running the app locally behind a Cloudflare tunnel so it can be tested
  inside the platform App Store, and — most importantly — inspecting the **extensions** an app can
  declare in its manifest (how the registry talks to the app: the settings/embed URL, the
  install/uninstall webhook, and per-event booking webhooks). Use when running any `peek` /
  `npx @peektravel/app-cli` command, deciding whether a feature is feasible on a platform, wiring
  the manifest, or debugging "which registry / am I logged in / why is it prompting me." Triggers on
  "peek CLI", "app-cli", "peek dev", "sync-app", "extensions list", "extensions show", "show-env",
  "auth whoami", "auth login", "which registry", "production vs sandbox", "skip-env-confirm",
  "what extensions are available", "app_registry_settings_url", "app_registry_webhook", "webhook_on".
---

# The Peek app CLI

`@peektravel/app-cli` (invoked as `peek` when installed, or `npx @peektravel/app-cli@latest`
otherwise) is the bridge between your local app and the **app registry**. It scaffolds apps,
runs them locally against the registry, pushes the manifest, and — the part you'll reach for most
while designing a build — **tells you which extensions the registry offers**, so you can check a
feature is even possible before you plan it.

This skill is the generic map of the CLI. Concrete manifest/registry details for your platform
live in `manifest-and-deploy` (and your platform's `*-manifest-and-deploy`); this skill is about
**driving the CLI itself**.

> **Keep this skill honest against the installed CLI.** Command names, flags, and extension slugs
> evolve. This skill is the durable shape; for the exact current surface, run `--help` and
> `extensions list`/`extensions show` (below) rather than trusting memory. If something here
> disagrees with the live CLI, the live CLI wins.

## 0. Get the latest CLI, then discover what it can do

1. **Always run the latest.** `npx` caches by version, so pin `@latest` to force a fresh resolve:
   ```bash
   npx @peektravel/app-cli@latest --version
   ```
   (If you have it installed globally as `peek`, `npm i -g @peektravel/app-cli@latest` first.)
2. **Read the command list** rather than assuming it — the CLI grows commands:
   ```bash
   npx @peektravel/app-cli@latest help
   ```
   `peek <command> --help` shows a single command's flags.

## 1. Two preflight checks before anything touches the registry

Every registry-touching command (`dev`, `sync-app`, `use-url`, `extensions *`, `auth *`) depends on
two bits of state. Check both up front so you're not debugging a 401 or a surprise prompt later.

### a. Which registry am I on? — `show-env`

```bash
npx @peektravel/app-cli@latest show-env
```

Tells you whether the CLI is pointed at the **production** registry or a **sandbox/override**. **You
should almost always be on production.** If it reports an override and you didn't intend it, reset:

```bash
npx @peektravel/app-cli@latest set-env --clear
```

> **Avoid the interactive override prompt.** When you're on a non-production registry, every command
> stops to ask *"Continue against this registry?"* — which stalls any non-interactive/agent run.
> Append **`--skip-env-confirm`** to auto-confirm for that invocation:
> ```bash
> npx @peektravel/app-cli@latest sync-app app.peek.json --skip-env-confirm
> ```
> It's a per-invocation flag — add it to **every** command you run while an override is active.

### b. Am I logged in? — `auth whoami`

```bash
npx @peektravel/app-cli@latest auth whoami
```

Shows the signed-in account and its registry. If it says you're not signed in, **the user must log
in** (it opens a browser flow — you can't do it for them):

```bash
npx @peektravel/app-cli@latest auth login
```

## 2. Run the app locally — `dev`

```bash
npx @peektravel/app-cli dev
```

`dev` does three things at once: runs the app locally, opens a **public Cloudflare tunnel** to it,
and **registers that tunnel URL with the app registry** — so the local build can be installed and
tested inside the platform's **App Store** with real auth. This is the only way to exercise the
embedded app for real; a plain framework dev server can't (no host frame, no token — see
`app-builder` "Running the app"). **You can't run this yourself** — it needs the user's credentials
— so hand off to the user when it's time to see the app run. What `dev` does to the manifest (it
creates a separate test app / `app-dev.json` and writes `.env.local`) is a `manifest-and-deploy`
concern.

## 3. Extensions — how the registry talks to the app

**Extensions (a.k.a. extendables) are the contract between the registry and your app.** An app
**declares** the extensions it uses in its **manifest** — `app.<platform>.json` (e.g.
`app.peek.json`), one manifest per platform. Running:

```bash
npx @peektravel/app-cli sync-app app.peek.json
```

**pushes that manifest to the registry**, activating the declared extensions. Extensions are the
entry points and event hooks that make the app do anything the platform surfaces.

### List what's available — `extensions list`

```bash
npx @peektravel/app-cli@latest extensions list                 # all platforms
npx @peektravel/app-cli@latest extensions list --platform peek # scope to one platform
npx @peektravel/app-cli@latest extensions list --json          # machine-readable
```

**Check this during design.** What's available differs **per platform** — a feature that leans on an
extension one platform offers may be impossible on another. Treat `extensions list --platform
<platform>` as part of the **feasibility / capability gate** (see `app-builder`): if the extension a
plan needs isn't listed for the selected platform, the plan won't ship — **flag it to the user**
rather than assuming it exists.

### The extensions to know

- **`app_registry_settings_url@v1`** — the URL the registry loads for the app's **settings page**,
  which is the **main app page the user sees after installing**. This is the app's **key entry
  point** — almost every app declares it. It's the embed URL the platform POSTs to (see
  `embed-and-auth`).
- **`app_registry_webhook@v1`** — declare this **if the app stores any local data.** It notifies the
  app when a user hits **install** (so you can provision eagerly instead of waiting for their first
  visit) and when they **uninstall**. The uninstall signal is **critical**: you're expected to
  **wipe all of that install's data on uninstall** (see `backoffice-data`, `webhooks`).
- **`webhook_on_…@v1`** — the family of **booking-system event webhooks** the app can subscribe to,
  to be notified when something happens (a booking created/changed/cancelled, etc.). These are the
  inbound-event path — how you build reactive features. See `webhooks` for the handling model.

### Get the config for one — `extensions show`

Each extension has its own required parameters and configuration for the manifest. **Don't guess the
shape — read it live:**

```bash
npx @peektravel/app-cli@latest extensions show app_registry_settings_url@v1
npx @peektravel/app-cli@latest extensions show app_registry_webhook@v1 --json
```

`extensions show <slug>` lists the extension's type, the platforms it's available on, and its
configurable fields — i.e. exactly what to put in `app.<platform>.json`. Use it whenever you wire a
new extension into the manifest.

## Hard rules

- **Confirm you're on production and logged in** (`show-env`, `auth whoami`) before registry work;
  reset a stray override with `set-env --clear`.
- **Add `--skip-env-confirm` to every command** while a non-production registry is active, so the
  override prompt never stalls a run.
- **Verify extensions exist for the SELECTED platform** (`extensions list --platform <platform>`)
  while judging feasibility — availability is platform-specific. Flag any gap to the user.
- **Declare `app_registry_webhook@v1` and wipe data on uninstall** whenever the app persists data.
- **Read `extensions show <slug>` for the manifest config** — don't hand-write extension params from
  memory.
- **You can't run `dev` or `auth login` for the user** — they need the user's credentials/browser.
  Hand off.

## Related skills

- `app-builder` — the build workflow this CLI serves; the capability gate and "Running the app"
  (why `dev` is the only real way to exercise the embed).
- `manifest-and-deploy` (+ your platform's `*-manifest-and-deploy`) — what the manifest declares,
  the two-app/two-environment split, and what `dev` / `sync-app` do to it.
- `embed-and-auth` — the settings/embed URL (`app_registry_settings_url@v1`) is the route the
  registry POSTs to.
- `webhooks` — handling the events `app_registry_webhook@v1` and `webhook_on_…` deliver.
- `backoffice-data` — per-install data scoping and the wipe-on-uninstall obligation.
