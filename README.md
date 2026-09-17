# Peek App CLI

Scaffold, develop, and publish apps for the Peek platform.

```bash
npm install -g @peektravel/app-cli
peek init my-app
```

`peek init` walks you through the whole first run: scaffolds a starter app,
installs dependencies, registers the app in the Peek app registry, and starts
it locally behind a public tunnel so you can install and try it immediately.

Requires Node.js 20 or newer.

## Commands

| Command | What it does |
| --- | --- |
| `peek init [app-name]` | Scaffold a new app from a starter template, register it, and start developing |
| `peek dev` | Run the app in the current directory behind a public Cloudflare tunnel, syncing the tunnel URL to the registry |
| `peek sync-app [file]` | Push your `app.json` manifest to the registry (or `--pull` the registry's copy back). Defaults to `./app.json` |
| `peek use-url <url>` | Point an app at a permanent base URL (a deployed host) and publish it. Targets the test app; `--prod` targets the real one |
| `peek extensions list` | List the extensions apps can plug into (`--platform peek\|acme\|cng` to scope, `--json` for scripting) |
| `peek extensions show <slug>` | Show one extension's type, platforms, and configurable fields (e.g. `booking_portal@v1`) |
| `peek auth login` / `peek auth logout` | Sign in to / out of the Peek app registry |
| `peek auth whoami` | Show which account you're signed in as, and against which registry |

Run `peek <command> --help` for flags (`--port`, `--platform`, `--no-sync`, ...).

## The two files in your app

| File | What it is |
| --- | --- |
| `app.json` | The **manifest**: the extensions your app plugs into, keyed by who consumes them — `registry` plus one key per platform. A platform key holding a list means the app runs there; `null` means it doesn't. That's all it holds. |
| `.peek-kit.json` | The **project file**: which app in the registry this directory publishes to (`app.id`), the test app the dev loop uses (`app.testId`), and what scaffolded it. Committed — the slug is identity, not a secret. |

Three things are deliberately *not* in the manifest:

- **The app's slug** — it's in the URL you push to, which is what lets one
  checked-in manifest be pushed at your real app and at your test app.
- **`base_url`** — the same manifest is served from a laptop tunnel, from
  staging and from production; only the origin differs, so `peek dev` and
  `peek use-url` set it on its own.
- **Name, description, icon, screenshots** — that's *listing* copy, it's per
  platform, and it's written and reviewed in the portal under
  *Apps → your app → Distribution*.

An app scaffolded before the manifest was flattened (a `{"data": {"app": …}}`
envelope, with an `app-dev.json` beside it) is migrated in place the next time
you run `peek dev` or `peek sync-app`: the manifest is rewritten flat, its slug
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
