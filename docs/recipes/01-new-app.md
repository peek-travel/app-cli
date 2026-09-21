# 01 — A brand new app

**You have:** nothing. No app in the registry, no code.

**You want:** an app running locally, installable from the platform's App Store, ready to build on.

**One command.** This is the case `peek init` exists for; don't assemble it from the smaller
commands.

## Do this

```bash
npm install -g @peektravel/app-cli
peek init example-app
```

The argument is the app's name (`example-app` stands in for yours throughout this recipe). It
becomes the directory and, slugified, the slug the registry knows it by — `Example App!` →
`example-app`. Leave it off and you'll be asked.

You'll be prompted for:

- **sign-in**, if you aren't already (opens a browser)
- **which platform** — Peek, ACME or Connectngo. Pass `--platform peek` to skip the question.

Everything else runs unattended, in this order:

1. checks the registry — `example-app` is free, so it's yours to create
2. copies the starter kit (vendored in the CLI: no clone, no network)
3. writes `app.json` (the manifest for your platform) and `.peek-kit.json` (which app this
   directory publishes to)
4. composes the Claude skills into `.claude/skills/`
5. `git init`, then installs dependencies
6. opens a public Cloudflare tunnel
7. creates `example-app` in the registry as an unpublished **draft**, clones its test app
   `example-app-test-dev`, points that at the tunnel and **publishes it**
8. writes `.env.local` and starts the dev server

It ends by printing **install links** — one per platform. Open one, install the app, and you're
looking at your local code running inside the real host, with real auth.

## What you have now

```
example-app/
  app.json           the manifest: extensions keyed by "global" + one key per platform
  .peek-kit.json     app.id = example-app  ·  app.testId = example-app-test-dev
  .env.local         PEEK_APP_URL, PEEK_APP_ID, PEEK_APP_SECRET  (gitignored for you)
  .claude/skills/    how an AI agent builds on this kit
  app/ lib/ ...      the Next.js starter kit
```

In the registry: **`example-app`** (draft, not published — nobody can install it) and
**`example-app-test-dev`** (published at your tunnel — what you just installed).

## Then, day to day

```bash
cd example-app
peek dev            # same loop again: new tunnel URL, test app re-pointed at it, dev server
```

Ctrl-C stops both the dev server and the tunnel. The tunnel URL is new every run, which is why
`peek dev` re-publishes the test app each time — and why the install link keeps working.

Changed `app.json`? `peek dev` pushes it on every restart. To push without running anything:

```bash
peek apps push
```

## When it's time to go live

```bash
# deploy your app somewhere real, then:
peek apps use-url https://example-app.fly.dev --prod
```

That sets your **source** app's `base_url` and publishes it — the first time your real app
becomes installable. Listing copy (name, description, icon, screenshots) is written in the
portal under *Apps → your app → Distribution*; it is deliberately not in `app.json`.

`PEEK_APP_SECRET` from `.env.local` is your **test app's** secret. Your production deploy needs
the source app's, which the registry shows exactly once — at creation. `peek init` prints it
with a "save this now" warning; if it's gone, rotate it in the portal.

## If you want the steps separately

| Flag | Stops at |
| --- | --- |
| `--no-dev` | scaffolds, installs, registers the app as a draft — no tunnel, no server |
| `--no-install` | scaffolds and registers; you run the install yourself |
| `--no-sync` | scaffolds only; touches the registry not at all |

`--no-dev` still registers, because only *publishing* needs a `base_url` — a draft doesn't.

## Gotchas

- **The directory must be new.** `init` refuses a directory that exists and isn't empty.
- **A name whose slug is already taken is adopted, not duplicated.** If `example-app` already
  exists in the registry, `init` says so and asks whether to build on it — because a slug is the
  address a push writes to, and scaffolding onto a taken one would overwrite that app's
  manifest. Say no and pick another name. (See [recipe 02](02-existing-app-new-codebase.md) for
  when adopting is what you want.)
- **`--with-claude`** flips the first question: instead of asking for a name it asks what the app
  should do, then has the Claude CLI invent the name and draft your listing copy into
  `LISTING.md`. Needs the `claude` CLI on your PATH.
- **On a team?** Everyone running `peek dev` shares `example-app-test-dev`, and the last run
  owns where the installed app points. Pass `--test <your-name>` for your own.
