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
  "peek CLI", "app-cli", "peek dev", "apps push", "apps pull", "peek tunnel", "extensions list", "extensions show", "env show",
  "auth whoami", "auth login", "which registry", "production vs sandbox", "skip-env-confirm",
  "what extensions are available", "app.json", "manifest shape", ".peek-kit.json", "apps use-url",
  "app_registry_settings_url", "app_registry_webhook", "webhook_on",
  "app_registry_mcp_url", "extensions list no output", "exit 255", "headless", "not signed in",
  "peek apps link", "peek apps list", "peek skills", "peek init --app", "existing app", "existing codebase",
  "sync-app", "use-url", "show-env", "set-env", "deprecated command", "command has been deprecated",
  "peek topics", "peek help apps",
  "link an existing app", "which app does this directory publish to", "list my apps",
  "scaffold for an existing app", "refresh skills", "dev --cmd".
---

# The Peek app CLI

`@peektravel/app-cli` (invoked as `peek` when installed, or `npx @peektravel/app-cli@latest`
otherwise) is the bridge between your local app and the **app registry**. It scaffolds apps,
runs them locally against the registry, pushes the manifest, points an existing codebase at an
app that already exists, and — the part you'll reach for most while designing a build — **tells you
which extensions the registry offers**, so you can check a feature is even possible before you plan
it.

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
3. **Commands are grouped into topics.** What acts on the current directory is top level —
   `init`, `dev`, `tunnel`, `skills`. What acts on the registry lives under a topic:

   ```
   peek init | dev | tunnel | skills                   this directory
   peek apps        list | link | push | pull | use-url   your apps in the registry
   peek extensions  list | show                           what apps can declare
   peek auth        login | logout | whoami              who you are
   ```

   `peek help apps` lists a topic's commands.

   > **Retired names still work, and say so.** `sync-app`, `use-url`, `show-env` and `set-env`
   > were the pre-topic names of `apps push`/`apps pull`, `apps use-url`, `env show` and `env set`.
   > They resolve and print a deprecation line naming the replacement (`sync-app --pull` forwards
   > to `apps pull`, a bare `sync-app` to `apps push`). If you see that warning in output — yours
   > or a user's — switch to the new name; don't treat it as an error.

## 1. Two preflight checks before anything touches the registry

Every registry-touching command (`dev`, `apps push`, `apps use-url`, `extensions *`, `auth *`) depends on
two bits of state. Check both up front so you're not debugging a 401 or a surprise prompt later.

### a. Which registry am I on? — `env show`

```bash
npx @peektravel/app-cli@latest env show
```

Tells you whether the CLI is pointed at the **production** registry or a **sandbox/override**. **You
should almost always be on production.** If it reports an override and you didn't intend it, reset:

```bash
npx @peektravel/app-cli@latest env set --clear
```

> **Avoid the interactive override prompt.** When you're on a non-production registry, every command
> stops to ask *"Continue against this registry?"* — which stalls any non-interactive/agent run.
> Append **`--skip-env-confirm`** to auto-confirm for that invocation:
> ```bash
> npx @peektravel/app-cli@latest apps push --skip-env-confirm
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

> **Sign in *before* running any registry command headless.** Every registry-touching command
> (`extensions list`/`show`, `apps push`, `dev`, …) calls an "ensure logged in" gate that, when
> you're **not** signed in, **auto-starts the browser login flow**. In a **non-interactive /
> agent shell** that flow can't complete — the command emits **no output and exits 255** (it isn't
> broken; it's silently waiting on a browser that never opens). So run `auth whoami` first; if it
> says not-signed-in, have the **user** run `auth login` in an interactive terminal, *then* re-run
> your command. This is the #1 cause of "`extensions list` printed nothing / exit 255."

## 2. Which command starts your project?

**`peek init` is the magic one.** From nothing, it signs the user in, scaffolds the starter kit,
installs it, creates the app in the registry, opens a public tunnel, publishes the test app at that
URL and starts the dev server — the app is installable and running about a minute later. When a
user has *nothing yet*, this is the answer; don't assemble it by hand from the smaller commands.

```bash
npx @peektravel/app-cli@latest init example-app
```

Every step is also its own command, because the other starting points don't want all of them.
Every registry command needs one fact — **which app in the registry does this directory publish
to?** — recorded in `.peek-kit.json` as `app.id`. How you get it depends on what you already have:

| You have | Command | What it does |
| --- | --- | --- |
| nothing | `peek init [name]` | **everything**: scaffold, install, register, tunnel, publish, run |
| an app in the registry, no code | `peek init <slug>` | the same, but **adopts that app**: its slug, and its live manifest pulled into `app.json` — nothing is created and nothing of the app's is overwritten (`--app <slug>` to fail rather than create if the slug is free) |
| a codebase *and* an app | `peek apps link [<slug>]` | writes `.peek-kit.json`, pulls the app's manifest to `app.json`, composes the Claude skills. **Scaffolds nothing, creates nothing** |
| a codebase, no app | `peek apps link <slug> --create` | the same, but creates the app (as a draft) from the manifest first |

```bash
npx @peektravel/app-cli@latest apps list              # which apps can I publish to?
npx @peektravel/app-cli@latest init example-app       # new starter kit FOR an existing app
npx @peektravel/app-cli@latest apps link example-app  # point THIS directory at one instead
```

### Source apps and test apps — only one of them is yours to build on

Every app you develop has **two** slugs in the registry, and they are not interchangeable:

| | Source app | Test app |
| --- | --- | --- |
| Slug | the one you named (`example-app`) | derived: `example-app-test-dev` |
| Created by | you — `init`, `apps link --create` | **`peek dev`**, cloned off the source |
| `base_url` | your deployed host (`apps use-url --prod`) | the tunnel, re-set every `dev` run |
| Recorded in `.peek-kit.json` as | `app.id` | `app.testId` |
| Build on it / link to it / `init` it | **yes** | **never** |
| Push a manifest at it | `apps push` | `apps push --test` |
| How many | one | one per `--test <name>`; `dev` is the shared default |

The test app is a **clone the dev loop owns**. Everything the developer installs and runs locally
is that clone; nothing you do should point a project at it. `apps list` hides them by default and
`apps link` / `init` refuse one outright (naming the source to use instead) — because the failure
otherwise lands much later: the registry won't clone a test app off a test app, so the next
`peek dev` dies with *"Cannot create a test app for a test app."*

> **A slug is an address, not just a name.** `init` checks the registry for the slug it's about
> to use even when the developer is naming a brand-new app, because a push writes to whatever app
> holds that slug — scaffolding onto a taken slug and pushing would overwrite that app's manifest.
> An existing slug that the developer typed themselves is adopted; one we derived from a name
> they typed is adopted only after they confirm, and never in a non-interactive shell.

- **`peek apps list`** lists the slugs this account can publish to (`--search`, `--json`). The publisher
  API has no app *names* — the slug is the identifier. Run it first whenever you need a slug.
  It shows **source apps only**; `--test-apps` adds the clones `peek dev` made, each labelled
  with the app it clones.
- **`peek apps link`** with no argument prompts from that same list. It is safe to re-run: it won't
  repoint an already-linked directory, or overwrite a differing `app.json`, without `--force`.
  `--no-manifest` leaves `app.json` alone; `--no-skills` skips the skill composition. A slug that
  isn't in the registry is an error unless you pass **`--create`** — so a typo can't quietly
  create a second app.
- **`peek skills`** (re)composes `.claude/skills` in the current directory for a platform + stack.
  It's local-only — no auth, no network. Run it after upgrading the CLI to refresh the skills, or
  in a codebase that was never scaffolded.

> **Never let `peek dev` invent an app.** In a directory with no `.peek-kit.json`, `dev` falls back
> to a slug derived from `package.json` "name" and **creates that app** — which silently makes a
> second app beside the one you meant. It warns and asks first (pass `-y` to accept, or `--app
> <slug>`), but the right fix is `peek apps link` **before** the first `dev`.

### Registering without running

`peek init --no-dev` (or `--no-install`) still registers the app: only **publishing** needs a
`base_url`, and a **draft** doesn't. So the app exists in the registry as an unpublished draft, and
`peek dev` / `peek apps use-url` publishes it when there's a URL to publish at. `--no-sync` opts out of
touching the registry entirely.

## 3. Run the app locally — `dev`, or `tunnel`

```bash
npx @peektravel/app-cli dev                     # start the app + tunnel + publish test app
npx @peektravel/app-cli tunnel                  # ...for an app you already started yourself
```

```bash
npx @peektravel/app-cli dev --app another-example-app  # develop against a different app
npx @peektravel/app-cli dev --cmd "make serve"        # start the app with something other than `<pm> run dev`
npx @peektravel/app-cli dev --test <your-name>        # your OWN test app, not the shared one
npx @peektravel/app-cli tunnel --port 8080            # the app is already listening on :8080
```

### Whose test app? — `--test <name>`

Both commands develop against `<app>-test-dev` by default. That default is **shared**: everyone
on the team who runs `dev` lands on the same test app, and whoever ran last owns its `base_url`
— so their teammate's tunnel is where the installed app points. `--test <name>` gives one
developer their own (`example-app-test-<your-name>`), created on first use and reused after:

```bash
npx @peektravel/app-cli dev --test <your-name>
export PEEK_TEST_IDENTIFIER=<your-name>   # ...or set it once, and stop passing the flag
```

Tell the user about this the moment a second person is working on the same app. Two notes: the
run always prints which test app it's on, and the one it used is recorded in `.peek-kit.json`
(`app.testId`) — a **committed** file — however the identifier arrived. The env var saves
repeating the flag, not that file change, so a personal test app shows up as a local diff the
developer shouldn't commit.

**Two commands, one difference: who starts the app.**

| | `peek dev` | `peek tunnel` |
| --- | --- | --- |
| Starts your app | yes — `<pm> run dev`, or `--cmd "<command>"` | **no** — you already did |
| Port | picks a free one from `--port` upward | exactly `--port`; warns if nothing is listening yet |
| Tunnel + test app published at it | yes | yes |
| `.env.local` refreshed | yes | yes (`--no-env` to skip) — **restart your server to pick it up** |

`tunnel` is the one for a codebase whose server is started by something else: a compose file, a
debugger, a watcher in another terminal, a framework command with its own flags. It holds the
tunnel open until ctrl-c and runs nothing of its own. With `--no-sync` it is a bare public URL and
touches the registry not at all.

`dev` does three things at once: runs the app locally, opens a **public Cloudflare tunnel** to it,
and **publishes your test app at that tunnel URL** — so the local build can be installed and
tested inside the platform's **App Store** with real auth. This is the only way to exercise the
embedded app for real; a plain framework dev server can't (no host frame, no token — see
`app-builder` "Running the app"). **You can't run this yourself** — it needs the user's credentials
— so hand off to the user when it's time to see the app run. What `dev` does with your app's
identity (it creates a separate **test app**, records it in `.peek-kit.json`, and writes
`.env.local`) is a `manifest-and-deploy` concern.

By default it starts the app with `<package manager> run dev`. A codebase whose dev server isn't an
npm script takes `--cmd "<shell command>"`; whatever you pass **must listen on `$PORT`**, because
that is the port the tunnel points at.

## 3b. Point an app at a real host — `apps use-url`

```bash
npx @peektravel/app-cli apps use-url https://myapp.vercel.app          # the test app
npx @peektravel/app-cli apps use-url https://myapp.vercel.app --prod   # the real app
```

A tunnel URL dies with the `dev` session. `apps use-url` sets an app's **`base_url`** to a permanent
origin and publishes it — this is the deploy-time counterpart to `dev`, and the only way the
origin is ever set (it is not a manifest field). `--prod` targets the app your `app.json`
belongs to; without it, the test app `dev` created.

## 4. Extensions — how the registry talks to the app

**Extensions (a.k.a. extendables) are the contract between the registry and your app.** An app
**declares** the extensions it uses in its **manifest** — `app.json` — which is a flat object of
extensions keyed by who consumes them: `global` for the ones that aren't platform-specific, plus
one key per platform:

```json
{
  "global": [
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

**That is all the manifest holds.** Which platforms the app runs on is *derived* from these keys
(a list means it runs there, `null` means it doesn't) — there is no `platforms` array, no
`base_url`, no app slug, and no name/description/listing copy. The slug lives in
`.peek-kit.json`; `base_url` is set per environment by `dev` / `apps use-url`; the store copy is a
per-platform **listing**, written in the portal.

Push it with:

```bash
npx @peektravel/app-cli apps push            # defaults to ./app.json
npx @peektravel/app-cli apps pull            # overwrite the local file with the registry's copy
npx @peektravel/app-cli apps pull --draft    # ...from the unpublished draft
```

**Pushing activates the declared extensions.** Extensions are the entry points and event hooks
that make the app do anything the platform surfaces.

> **A key you leave out is not a key set to `null`.** An absent platform key means "leave that
> platform exactly as it is"; `null` means "stop running there". A typo'd key is rejected with a
> 400 rather than silently ignored. When you edit the manifest, keep every platform key present.

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
- **`app_registry_mcp_url@v1`** — declares the app's **MCP endpoint** so the store's AI orchestrator
  can drive it headlessly. One parameter, **`mcp_url`** (the route Peek calls). Declare it when the
  app exposes MCP tools — see `mcp-endpoint`.

### Get the config for one — `extensions show`

Each extension has its own required parameters and configuration for the manifest. **Don't guess the
shape — read it live:**

```bash
npx @peektravel/app-cli@latest extensions show app_registry_settings_url@v1
npx @peektravel/app-cli@latest extensions show app_registry_webhook@v1 --json
```

`extensions show <slug>` lists the extension's type, the platforms it's available on, and its
configurable fields — i.e. exactly what to put in `app.json`. Use it whenever you wire a new
extension into the manifest.

## Hard rules

- **Confirm you're on production and logged in** (`env show`, `auth whoami`) before registry work;
  reset a stray override with `env set --clear`.
- **`peek init` when there's nothing yet.** It is the one command that does the whole first run;
  reach for the granular ones only when a step is already done or unwanted.
- **Don't start the app twice.** If the user runs their own server, it's `peek tunnel`, not
  `peek dev` — `dev` would start a second copy on a different port.
- **Link before you dev.** In a directory with no `.peek-kit.json`, run `peek apps list` then
  `peek apps link <slug>` — never let `peek dev` derive a slug and create an app you didn't mean.
- **`peek apps link` and `peek init <slug>` for an app that already exists.** Don't re-create it
  under a new slug, and don't hand-write `.peek-kit.json`.
- **Never point a project at a `*-test-dev` slug.** That's a clone `peek dev` owns — link to (and
  `init` from) the app it clones. The CLI refuses either way, and `apps list --test-apps` is the
  only place they're shown.
- **Add `--skip-env-confirm` to every command** while a non-production registry is active, so the
  override prompt never stalls a run.
- **Verify extensions exist for the SELECTED platform** (`extensions list --platform <platform>`)
  while judging feasibility — availability is platform-specific. Flag any gap to the user.
- **Declare `app_registry_webhook@v1` and wipe data on uninstall** whenever the app persists data.
- **Read `extensions show <slug>` for the manifest config** — don't hand-write extension params from
  memory.
- **Keep `app.json` a pure manifest.** No slug, no `base_url`, no listing copy, every platform key
  present. Unknown top-level keys fail the push with a 400.
- **You can't run `dev` or `auth login` for the user** — they need the user's credentials/browser.
  Hand off.

## Related skills

- `app-builder` — the build workflow this CLI serves; the capability gate and "Running the app"
  (why `dev` is the only real way to exercise the embed).
- `manifest-and-deploy` (+ your platform's `*-manifest-and-deploy`) — what the manifest declares,
  the two-app/two-environment split, and what `dev` / `apps push` do to it.
- `embed-and-auth` — the settings/embed URL (`app_registry_settings_url@v1`) is the route the
  registry POSTs to.
- `webhooks` — handling the events `app_registry_webhook@v1` and `webhook_on_…` deliver.
- `backoffice-data` — per-install data scoping and the wipe-on-uninstall obligation.
