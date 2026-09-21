# Peek App CLI

Scaffold, develop, and publish apps for the Peek platform.

```bash
npm install -g @peektravel/app-cli
peek init example-app
```

**That one command does everything.** `peek init` signs you in, scaffolds the
starter kit, installs its dependencies, creates your app in the Peek app
registry, opens a public tunnel, publishes your test app at that URL, and starts
the dev server — so about a minute after you type it, the app is installable
from the platform's App Store and running off your laptop.

Every step it does is also a command of its own, for when you don't want all of
them (`peek apps link`, `peek skills`, `peek apps push`, `peek tunnel`,
`peek dev`), or turn steps off with `--no-install` / `--no-sync` / `--no-dev`.

Requires Node.js 20 or newer.

### Recipes

Start-to-finish walkthroughs live in [`docs/recipes/`](docs/recipes/README.md):

- [A brand new app](docs/recipes/01-new-app.md) — nothing in the registry yet
- [A new codebase for an app that already exists](docs/recipes/02-existing-app-new-codebase.md)
- [An existing codebase, keeping the code exactly as it is](docs/recipes/03-existing-codebase-existing-app.md)

### Already have an app in the registry?

Give `init` its slug and it adopts that app instead of creating one — same one
command, same result, except the slug and manifest come from the registry and
nothing of the app's is overwritten:

```bash
peek apps list          # which apps can I publish to?
peek init example-app   # scaffold a kit that publishes to that app
```

`init` checks the registry either way, because an app's slug is also the address
a push writes to: without the check, scaffolding under a name that's already
taken would push the starter kit's manifest over that app's. A slug nothing has
yet is simply a new app. `--app <slug>` is the strict form — it fails rather
than creating, which is what you want in a script.

### Already have a codebase?

Then you don't want the scaffolding at all:

```bash
peek apps link example-app          # point THIS directory at an existing app
peek apps link example-app --create # ...or create the app for this codebase
```

`link` writes `.peek-kit.json` (which app this directory publishes to) and pulls
the app's manifest into `app.json`, which is all `peek dev` / `peek apps push`
need.

## Commands

Commands that act on **this directory** are top level; everything that acts on the
**registry** lives under a topic (`peek apps`, `peek extensions`, `peek auth`).
`peek help <topic>` lists a topic's commands.

**Your project**

| Command | What it does |
| --- | --- |
| `peek init [name-or-slug]` | Scaffold a new app from a starter template, register it, and start developing. Given the slug of an app that already exists, that app is adopted instead — its slug and its manifest. `--app <slug>` requires an existing app rather than creating one |
| `peek dev` | Start the app, put it behind a public Cloudflare tunnel, and publish your test app at that URL. `--app <slug>` targets another app, `--cmd "<command>"` replaces `<pm> run dev`, `--test <name>` uses your own test app instead of the shared one |
| `peek tunnel` | The same tunnel + publish, for an app **you** already started. `--port` where it listens, `--no-env` to leave `.env.local` alone, `--no-sync` for a bare tunnel, `--test <name>` as above |
| `peek skills` | Compose (or refresh) this app's Claude skills in `.claude/skills`. Local only — no auth, no network |

**Your apps in the registry — `peek apps`**

| Command | What it does |
| --- | --- |
| `peek apps list` | List the apps this account can publish to (`--search`, `--json`). Shows source apps; `--test-apps` adds the clones `peek dev` made, labelled with what each clones |
| `peek apps link [app-slug]` | Point the current directory at an app that already exists: records its slug, pulls its manifest, composes the Claude skills. Prompts from your apps when the slug is omitted; `--create` creates the app if the slug is free |
| `peek apps push [file]` | Push your `app.json` manifest to the registry. `--no-publish` to leave it a draft, `--test` to target the test app. Defaults to `./app.json` |
| `peek apps pull [file]` | Overwrite your `app.json` with the registry's copy. `--draft` for the unpublished version |
| `peek apps use-url <url>` | Point an app at a permanent base URL (a deployed host) and publish it. Targets the test app; `--prod` targets the real one |

**What the registry offers, and who you are**

| Command | What it does |
| --- | --- |
| `peek extensions list` | List the extensions apps can plug into (`--platform peek\|acme\|cng` to scope, `--json` for scripting) |
| `peek extensions show <slug>` | Show one extension's type, platforms, and configurable fields (e.g. `booking_portal@v1`) |
| `peek auth login` / `peek auth logout` | Sign in to / out of the Peek app registry |
| `peek auth whoami` | Show which account you're signed in as, and against which registry |

Run `peek <command> --help` for flags (`--port`, `--platform`, `--no-sync`, ...).

`sync-app`, `use-url`, `show-env` and `set-env` were the pre-topic names of
`apps push`/`apps pull`, `apps use-url`, `env show` and `env set`. They still
work and print a notice pointing at the command that replaced them.

`peek init --no-dev` still registers the app: only *publishing* needs a
`base_url`, so the app lands in the registry as an unpublished draft and
`peek dev` / `peek apps use-url` publishes it once there's a URL. `--no-sync` opts
out of the registry entirely.

## The two files in your app

| File | What it is |
| --- | --- |
| `app.json` | The **manifest**: the extensions your app plugs into, keyed by who consumes them — `global` plus one key per platform. A platform key holding a list means the app runs there; `null` means it doesn't. That's all it holds. |
| `.peek-kit.json` | The **project file**: which app in the registry this directory publishes to (`app.id`), the test app the dev loop uses (`app.testId`), and what scaffolded it. Committed — the slug is identity, not a secret. |

Three things are deliberately *not* in the manifest:

- **The app's slug** — it's in the URL you push to, which is what lets one
  checked-in manifest be pushed at your real app and at your test app.
- **`base_url`** — the same manifest is served from a laptop tunnel, from
  staging and from production; only the origin differs, so `peek dev` and
  `peek apps use-url` set it on its own.
- **Name, description, icon, screenshots** — that's *listing* copy, it's per
  platform, and it's written and reviewed in the portal under
  *Apps → your app → Distribution*.

An app scaffolded before the manifest was flattened (a `{"data": {"app": …}}`
envelope, with an `app-dev.json` beside it) is migrated in place the next time
you run `peek dev` or `peek apps push`: the manifest is rewritten flat, its slug
and test app move into `.peek-kit.json`, and `app-dev.json` is removed.

## How local development works

`peek dev` (and the tail of `peek init`) starts a Cloudflare quick tunnel to
your local dev server, then does four things in the registry: pushes your
manifest at your app as a draft (creating the app on the first run), asks for
that app's **test app**, pushes the same manifest at it, and publishes it
pointed at the tunnel. Everything you install and run locally is that test
app — your real app is never given the ephemeral tunnel URL. Two things to
know:

- **Your dev server becomes publicly reachable** at an unauthenticated
  `*.trycloudflare.com` URL while `peek dev` runs. The URL is random and
  ephemeral (new one per run), but anyone who has it can reach your local app.
- If you'd rather start the app yourself, `peek tunnel` is the same thing with
  the starting left out: it tunnels to the port you're already serving on,
  publishes the test app there, and holds the tunnel open until ctrl-c.
- **The default test app is shared.** `dev` / `tunnel` develop against
  `<app>-test-dev`, so on a team the last person to run one owns where the
  installed app points. Pass `--test <your-name>` (or set
  `PEEK_TEST_IDENTIFIER`) to get your own `<app>-test-<your-name>`.
- Your app's credentials live in `.env.local` (`PEEK_APP_SECRET`,
  `PEEK_APP_URL`, ...). The CLI makes sure `.env.local` is gitignored —
  keep it that way, and set `PEEK_APP_SECRET` as a real environment variable
  in production deploys.

`peek init` scaffolds from a starter kit bundled inside the CLI — it is copied
into place with no network fetch and no repo to clone. The scaffolded app is a
regular Next.js project: `peek init` runs its dependency install and dev server.

## Contributing

```bash
pnpm install
pnpm run build
pnpm test
```

Two entrypoints for running the CLI from a checkout:

- `./bin/dev.js` — runs source directly via `tsx`, no build step. Fast inner
  loop. Must be run from the repo root (module resolution for `tsx` is
  relative to the process cwd, not the script).
- `node ./bin/run.js` — runs the compiled `dist/`. This is what ships. Run
  `pnpm run build` first.

```bash
./bin/dev.js init --help
```

### Testing `peek init` locally

A minimal fixture template lives at `test/fixtures/starter-nextjs` for
offline/fast iteration. Point `init` at it with the `PEEK_INIT_TEMPLATE` env
var (a test-only seam — there is no user-facing template option):

```bash
cd /tmp && mkdir scratch && cd scratch
PEEK_INIT_TEMPLATE="file:/path/to/peek-cli/test/fixtures/starter-nextjs" \
  node /path/to/peek-cli/bin/run.js init demo-app --no-dev

cd demo-app && npm run dev   # confirm localhost:3000 serves the starter
```

`test/init.e2e.test.ts` runs the compiled CLI end-to-end against that fixture:
scaffolds into a temp dir, does a real `npm install`, and asserts the
substitutions, install, and `git init` all happened. Rebuild before running
tests if you've touched `src/`:

```bash
pnpm run build && pnpm test
```

## License

[MIT](./LICENSE)
