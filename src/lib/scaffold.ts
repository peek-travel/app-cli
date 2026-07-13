import { cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadTemplate } from "giget";
import { execa } from "execa";
import { CLIError } from "../errors.js";

export const DEFAULT_TEMPLATE = "github:peek-travel/nextjs-starter-kit";

// Files checked for {{APP_NAME}} / {{APP_SLUG}} placeholders. Kept as a small explicit
// list — no templating engine, just string replace.
const TEMPLATE_VAR_FILES = ["package.json", "README.md", "app/layout.tsx", "app.json"];

const LOCAL_SOURCE_RE = /^(file:|\.{1,2}\/|\/)/;

export async function fetchTemplate(source: string, targetDir: string): Promise<void> {
  try {
    if (LOCAL_SOURCE_RE.test(source)) {
      // giget has no local-filesystem provider — local paths cover scratch/dev templates
      // without a real git host.
      const path = source.startsWith("file:") ? fileURLToPath(new URL(source)) : source;
      await cp(path, targetDir, { recursive: true });
      return;
    }

    await downloadTemplate(source, { dir: targetDir, force: false });
  } catch (error) {
    throw new CLIError(
      `Failed to fetch template "${source}": ${(error as Error).message}`,
      "Check your network connection and that the template repo exists.",
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
