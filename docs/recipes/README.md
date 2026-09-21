# Recipes

Start-to-finish walkthroughs for the situations developers actually arrive in. Each one is a
single file you can follow top to bottom.

| You have | Recipe |
| --- | --- |
| Nothing — new to Peek, no app in the registry | [01 — A brand new app](01-new-app.md) |
| An app in the registry, and you want a fresh JavaScript codebase for it | [02 — A new codebase for an app that already exists](02-existing-app-new-codebase.md) |
| A working app in some other framework, already live, and you want the CLI from here on | [03 — An existing codebase, keeping the code exactly as it is](03-existing-codebase-existing-app.md) |

## The two things every recipe assumes

**1. You're signed in, against the registry you meant.**

```bash
peek auth whoami
```

It prints the account and the registry. **Production is the default** and is what you want
unless you're a registry developer. If `whoami` says you're not signed in, `peek auth login`
opens a browser. Do that *before* anything else — a registry command that finds you signed out
starts the browser flow itself, which in a non-interactive shell means no output and exit 255.

**2. Two apps, not one.**

Everything you install and run locally is a **test app** — a clone the CLI makes off your real
app, published at your laptop's tunnel URL. Your real app never gets the tunnel URL and is never
published by the dev loop.

Examples throughout these recipes call the app **`example-app`**. Substitute your own slug.

| | Source app | Test app |
| --- | --- | --- |
| Slug | the one you named — `example-app` | `example-app-test-dev` (or `example-app-test-<your-name>` with `--test <your-name>`) |
| Created by | you (`peek init`, `peek apps link --create`) | `peek dev` / `peek tunnel` |
| `base_url` | your deployed host | the tunnel, re-set every run |
| In `.peek-kit.json` | `app.id` | `app.testId` |

The CLI refuses to point a directory at a test app — you'd be trying to develop against
someone's environment, and the registry won't clone a test app off a test app. It names the
source app to use instead.

## Which command does what

```
peek init [name-or-slug]   everything at once: scaffold, register, tunnel, publish, run
peek dev                   start the app + tunnel + publish the test app
peek tunnel                the same, for an app you start yourself
peek skills                (re)compose .claude/skills

peek apps list             which apps can I publish to?
peek apps link [slug]      point THIS directory at an existing app
peek apps push [file]      push app.json to the registry
peek apps pull [file]      overwrite app.json from the registry
peek apps use-url <url>    point an app at a deployed host and publish it
```

`peek help apps` lists the topic, and `peek <command> --help` has the flags. Retired names
(`sync-app`, `use-url`, `show-env`, `set-env`) still work and tell you their replacement.

> **On a non-production registry?** Every command warns and asks "Continue against this
> registry?". Add `--skip-env-confirm` to each one to auto-confirm, and `peek env set --clear`
> to go back to production.
