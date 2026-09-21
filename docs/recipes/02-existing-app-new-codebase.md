# 02 — A new codebase for an app that already exists

**You have:** an app in the registry — called `example-app` throughout this recipe. Maybe live,
maybe built by someone else, maybe created in the portal and never shipped.

**You want:** a fresh JavaScript/Next.js starter kit that publishes to *that* app, running
locally against its own test app.

**Same one command as a new app — just give it the slug instead of a name.**

## Do this

```bash
peek apps list                  # find the slug; test apps are hidden from this list
peek init example-app
```

`init` looks the slug up first. Because something already holds it, it **adopts** that app
instead of creating one:

```
◇  example-app already exists in the registry
◇  This kit will publish to example-app — its manifest is what lands in app.json,
   and nothing of its own is overwritten.
```

From there it's the ordinary flow: starter kit into `./example-app/`, skills composed,
dependencies installed, tunnel opened, test app `example-app-test-dev` created and
published at the tunnel, dev server up, install links printed.

Two differences from a new app:

- **`app.json` is the app's own manifest**, pulled from the registry — not the kit's example.
  (The kit's example would replace real extension declarations with sample ones.) Specifically
  it's the app's **draft**: the newest thing the registry holds, which may not be what customers
  are running. `peek apps pull` (no flags) replaces it with the **published** version if you'd
  rather start from what's live.
- **No platform question.** It's derived from the manifest. If the app targets more than one
  platform you'll be asked which one to compose skills for; pass `--platform` to skip it.

Want the directory named something other than the slug? `peek init "Example App" --app
example-app`. `--app` is also the strict form — it fails if the slug *isn't* in the
registry, which is what you want in a script.

## The one thing that will surprise you

**The manifest you pulled describes the old app, not the kit.** Look at it before you build:

```bash
cat app.json
```

Two shapes, both common:

- **It declares routes the kit doesn't serve** — e.g. `app_registry_settings_url` pointing at
  `/partners/settings`. Install the test app and that page 404s, because the kit serves
  `/examples/peek-pro/main`.
- **It declares nothing** — `"global": []`. Plenty of real apps look like this. Then the app
  surfaces nothing at all until you declare extensions; `peek extensions list` shows what's
  available and `peek extensions show <slug>` gives you the exact config shape.

For the first case, pick one:

**A. Repoint the manifest at the kit's routes** — you're rebuilding, and the kit's example paths
are where the new code lives. Edit `app.json`:

```json
{ "slug": "app_registry_settings_url@v1",
  "configuration": { "url": "/examples/peek-pro/main", "url_mode": "prepend_base_url" } }
```

**B. Build the old routes in the new kit** — keep the manifest untouched and add the pages the
declarations already name. Better if the app is live and installed: the manifest and production
stay in agreement the whole way.

`peek dev` pushes `app.json` on every restart, so either way the test app follows along.

## What this does and doesn't touch in the registry

| | What happens |
| --- | --- |
| `example-app` (your real app) | its **draft** is updated with whatever `app.json` says. Never published by `dev` — installed users see nothing change |
| `example-app-test-dev` | created if new, pointed at your tunnel, **published** — this is what you install |

So editing `app.json` is safe to iterate on: it moves the prod app's draft, not its live version.
Publishing is a separate, deliberate step:

```bash
peek apps push                                     # push + publish (asks first, loudly, for a
                                                   # production app)
peek apps push --no-publish                        # push, leave it a draft
peek apps use-url https://your-host --prod         # set prod's base_url and publish
```

## Gotchas

- **The directory must be new.** `init` won't scaffold into a non-empty one.
- **Don't pass a `*-test-*` slug.** That's a test app; the CLI refuses and names the source app
  to use instead. `peek apps list --test-apps` shows which is which.
- **A teammate may already own `-test-dev`.** Whoever ran `dev` last owns where it points. Get
  your own with `peek dev --test <your-name>` (or `export PEEK_TEST_IDENTIFIER=<your-name>`).
- **An app with no published version** has nothing to pull, so the kit's own starter manifest is
  used. The CLI says so.
- **Test apps you already have whose slugs aren't the derived form** are not reachable from the
  dev loop. It only ever creates or reuses `<source>-test-<identifier>`, so a clone someone made
  by hand (or in the portal) under some other name can't be developed against with `dev` /
  `tunnel`.
- **`.env.local`'s `PEEK_APP_SECRET` is the test app's**, not production's. Production's is set by
  you, in your host's environment.
