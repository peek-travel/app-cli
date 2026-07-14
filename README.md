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
| `peek sync-app <file>` | Push an `app.json` to the registry (or `--pull` the registry version) |
| `peek extensions list` | List the extensions apps can plug into (`--platform peek\|acme\|cng` to scope, `--json` for scripting) |
| `peek extensions show <slug>` | Show one extension's type, platforms, and configurable fields (e.g. `booking_portal@v1`) |
| `peek auth login` / `peek auth logout` | Sign in to / out of the Peek app registry |
| `peek auth whoami` | Show which account you're signed in as, and against which registry |

Run `peek <command> --help` for flags (`--port`, `--template`, `--no-sync`, ...).

## How local development works

`peek dev` (and the tail of `peek init`) starts a Cloudflare quick tunnel to
your local dev server and publishes the tunnel URL to the registry as your
app's test-app `base_url`. Two things to know:

- **Your dev server becomes publicly reachable** at an unauthenticated
  `*.trycloudflare.com` URL while `peek dev` runs. The URL is random and
  ephemeral (new one per run), but anyone who has it can reach your local app.
- Your app's credentials live in `.env.local` (`PEEK_APP_SECRET`,
  `PEEK_APP_URL`, ...). The CLI makes sure `.env.local` is gitignored —
  keep it that way, and set `PEEK_APP_SECRET` as a real environment variable
  in production deploys.

`--template` accepts any [giget](https://github.com/unjs/giget) source
(`github:owner/repo`, a URL, or a local `file:`/relative path). Templates are
regular npm projects: scaffolding runs their dependency install and dev
server, which executes code from that template — only point it at sources you
trust.

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
offline/fast iteration:

```bash
cd /tmp && mkdir scratch && cd scratch
node /path/to/peek-cli/bin/run.js init demo-app \
  --template "file:/path/to/peek-cli/test/fixtures/starter-nextjs" \
  --no-dev

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
