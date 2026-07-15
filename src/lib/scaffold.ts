import { cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { CLIError } from "../errors.js";

// The default starter kit is vendored into the CLI package under templates/ (see the
// package.json "files" list) so `peek init` works offline and always ships a known-good
// version — no git/tarball fetch at runtime. Resolved relative to this module: both
// src/lib/scaffold.ts and dist/lib/scaffold.js sit two dirs below the package root, so
// ../../templates lands on the vendored copy in dev and in the published package alike.
export const DEFAULT_TEMPLATE = fileURLToPath(
  new URL("../../templates/nextjs-starter-kit", import.meta.url),
);

// Files checked for {{APP_NAME}} / {{APP_SLUG}} placeholders. Kept as a small explicit
// list — no templating engine, just string replace.
const TEMPLATE_VAR_FILES = ["package.json", "README.md", "app/layout.tsx", "app.json"];

// Build artifacts / installed deps that must never be copied into a scaffolded app. npm
// already strips node_modules at publish, but a local dev checkout of the vendored kit
// carries them (hundreds of MB) — without this filter every `peek init` in dev would clone
// the whole tree and installDependencies would run against stale, mis-linked modules.
const TEMPLATE_COPY_IGNORE = new Set(["node_modules", ".next", ".git"]);

// Copies the starter kit from the local filesystem into the new app dir. The source is
// always the kit vendored into the CLI — nothing is downloaded at scaffold time.
export async function fetchTemplate(source: string, targetDir: string): Promise<void> {
  try {
    await cp(source, targetDir, {
      recursive: true,
      filter: (src) => !TEMPLATE_COPY_IGNORE.has(basename(src)),
    });
  } catch (error) {
    throw new CLIError(
      `Failed to scaffold from template "${source}": ${(error as Error).message}`,
      "The bundled starter kit is missing from the CLI install — reinstall @peektravel/app-cli.",
    );
  }
}

// The starter kit ships one manifest per platform (app.peek.json, app.acme.json,
// app.cng.json) and no plain app.json. Pick the selected platform's manifest and copy it
// into app.json, which the rest of the flow (var substitution, sync, serve) expects.
export async function selectPlatformManifest(
  targetDir: string,
  platform: string,
): Promise<void> {
  const src = join(targetDir, `app.${platform}.json`);
  const dest = join(targetDir, "app.json");
  if (!existsSync(src)) {
    throw new CLIError(
      `Template has no app.${platform}.json`,
      "The starter kit must ship a manifest for the selected platform.",
    );
  }
  await cp(src, dest);
}

export async function substituteTemplateVars(
  targetDir: string,
  vars: Record<string, string>,
): Promise<void> {
  for (const file of TEMPLATE_VAR_FILES) {
    const path = join(targetDir, file);
    if (!existsSync(path)) continue;

    let contents = await readFile(path, "utf8");
    for (const [key, value] of Object.entries(vars)) {
      contents = contents.replaceAll(`{{${key}}}`, value);
    }
    await writeFile(path, contents, "utf8");
  }
}

// Make sure the project's .gitignore covers .env.local before a secret lands in it.
// Templates are supposed to ship a .gitignore, but nothing guarantees it — without this,
// `git init` + a later commit would push PEEK_APP_SECRET to the developer's remote.
async function ensureEnvLocalIgnored(targetDir: string): Promise<void> {
  const path = join(targetDir, ".gitignore");
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";

  const covered = existing
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === ".env.local" || line === ".env*" || line === "*.local" || line === ".env*.local");
  if (covered) return;

  const prefix = existing.length ? `${existing.replace(/\n*$/, "")}\n\n` : "";
  await writeFile(path, `${prefix}# Local env (contains secrets)\n.env.local\n`, "utf8");
}

// Upsert KEY=value pairs into <targetDir>/.env.local, preserving any lines already there.
// Also guarantees .env.local is gitignored — it holds PEEK_APP_SECRET.
export async function writeEnvLocal(
  targetDir: string,
  vars: Record<string, string>,
): Promise<void> {
  await ensureEnvLocalIgnored(targetDir);

  const path = join(targetDir, ".env.local");
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";

  const lines = existing.length ? existing.replace(/\n*$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx === -1) lines.push(line);
    else lines[idx] = line;
  }

  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function gitInit(targetDir: string): Promise<void> {
  await execa("git", ["init"], { cwd: targetDir });
}

export async function installDependencies(
  pm: string,
  args: string[],
  targetDir: string,
): Promise<void> {
  try {
    await execa(pm, args, { cwd: targetDir, stdio: "inherit" });
  } catch (error) {
    throw new CLIError(
      `"${pm} ${args.join(" ")}" failed in ${targetDir}`,
      `The project files are in place. cd into ${targetDir} and run "${pm} ${args.join(" ")}" manually.`,
    );
  }
}
