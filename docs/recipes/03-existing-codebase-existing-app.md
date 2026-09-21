# 03 — An existing codebase, keeping the code exactly as it is

**You have:** an app written a while back — Phoenix, Rails, Django, Go, a plain Node server,
anything — live in production, installed by real customers.

**You want:** to manage it with the CLI from here on (push the manifest, run it locally against
a test app) **without changing a line of application code**.

**You don't want `peek init`.** Nothing is scaffolded here. Two commands: `apps link` to record
what this directory is, `tunnel` to run it.

## Step 1 — point the directory at the app

```bash
cd ~/code/example-app
peek apps list                                   # find the slug
peek apps link example-app --no-skills
```

That writes exactly two files and touches nothing else:

- **`.peek-kit.json`** — `app.id: example-app`. This is the answer to "which app does this
  directory publish to?", which every later command needs. It's meant to be committed.
- **`app.json`** — the app's manifest, pulled from the registry. It's the **draft** (the newest
  version on file); `peek apps pull` afterwards replaces it with the **published** one if those
  have diverged and you want what customers are running.

`--no-skills` because the skills in `.claude/skills/` teach JavaScript/Next.js patterns; in a
Phoenix or Rails repo they'd be misleading. Drop the flag if you want them anyway.

**Already have an `app.json`?** `link` compares it with the registry's and asks before
overwriting. Two useful answers:

- Keep yours (say no, or pass `--no-manifest`) — it's the source of truth and you'll push it.
  An old-format manifest (the `{"data": {"app": …}}` envelope) is migrated to the flat shape the
  first time the CLI reads it, and any `base_url` in it is dropped: that's per-environment now.
- Take the registry's (`--force` to skip the question) — production is the source of truth.

## Step 2 — run it locally against a test app

Start your app the way you always do. Then, in another terminal, point a public URL at it:

```bash
mix phx.server                 # ...whatever you normally run. Say it listens on :4000

peek tunnel --port 4000
```

`peek tunnel` does the half only the CLI can do, and **starts nothing**:

1. opens a Cloudflare tunnel to `:4000` (and warns if nothing's listening there yet)
2. pushes `app.json` at `example-app` as a **draft** — production's live version is
   untouched
3. creates/reuses the test app `example-app-test-dev`, points it at the tunnel and
   **publishes it**
4. writes `PEEK_APP_URL` / `PEEK_APP_ID` / `PEEK_APP_SECRET` to `.env.local`
5. holds the tunnel open until Ctrl-C, and prints the install links

`peek dev` is the wrong command here — it would try to start your app with `<pm> run dev`. (It
does take `--cmd "make serve"`, but only if your start command honours `$PORT`. If it reads a
port from config, `tunnel --port` is the right tool.)

### Getting the credentials into *your* app's environment

`.env.local` is a Next.js convention. A Phoenix or Rails app won't read it, so either read the
values out of it in your own config, or keep the CLI out of your env entirely:

```bash
peek tunnel --port 4000 --no-env
```

With `--no-env` nothing is written and a newly minted test-app secret is **printed** instead —
save it then, because the registry shows it exactly once. Export what your app needs:

```bash
export PEEK_APP_URL=https://<the-tunnel-url>
export PEEK_APP_ID=example-app-test-dev
export PEEK_APP_SECRET=<printed once, at creation>
```

**Restart your server after the first run.** It booted before the CLI wrote/printed any of this,
so it's still holding the previous values — including the previous tunnel URL. The CLI reminds
you.

## Step 3 — from here on

```bash
peek apps pull                 # someone edited in the portal? get the registry's copy
# edit app.json — add a webhook, change the settings URL, declare an extension
peek apps push                 # push it, and publish
peek apps push --no-publish    # ...or leave it as a draft to publish later
```

For a **production** app the registry refuses a blind auto-publish, so `push` warns —
*"Auto-publishing this app would create a new production version"* — and asks *"Proceed with
production publish?"*. Answer deliberately: that's the version your installed customers get.

Moved hosts, or changed the origin your relative extension URLs resolve against?

```bash
peek apps use-url https://example-app.example.com --prod
```

`--prod` targets the source app. Without it, `use-url` targets the **test** app — which is
usually what you want only when you've deployed a long-lived staging build.

## What the CLI adds to your repo

Three files, plus a `.env.local` entry in `.gitignore` if nothing there covers it already:

```
.peek-kit.json     commit this — it's the app's identity, not a secret
app.json           commit this — it's the manifest you push
.env.local         NOT committed. The CLI appends it to .gitignore if nothing covers it
```

No source file is read or written. `--no-skills` keeps `.claude/` out too.

## Gotchas

- **Don't link to a test app.** If your old `app.json` names one (an app scaffolded years ago
  might carry `.data.app.id` of a sandbox clone), the CLI stops before opening the tunnel and
  names the source app to use instead. Nothing is recorded when it refuses.
- **`peek tunnel --no-sync`** is a bare public URL: no manifest push, no test app, no registry.
  Useful for a quick "is my webhook reachable" check.
- **On a team**, `--test <your-name>` gives you your own test app instead of everyone sharing
  `-test-dev`; `export PEEK_TEST_IDENTIFIER=<your-name>` saves typing it every run. Either way
  the test app you used is recorded in `.peek-kit.json` (`app.testId`), which is a committed
  file — so that line will show as a local change. Leave it out of your commits.
- **Your production app is never published by the dev loop.** `dev` and `tunnel` only ever
  publish the test app; production moves when *you* run `apps push` or `apps use-url --prod`.
