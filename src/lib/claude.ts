import { writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

// Optional integration: if the developer has the Claude Code CLI installed, we use it to
// name the app and write its listing copy from a plain-language goal. Everything here
// degrades to a no-op when `claude` is absent or misbehaves — init must never fail on it.

// Candidate binaries to probe, in preference order. `claude` on PATH is the normal case;
// the rest cover real installs where PATH is shadowed (e.g. an asdf/mise shim with no
// version pinned) — the documented local install, then the newest VS Code extension binary.
function claudeCandidates(): string[] {
  const home = homedir();
  const candidates = ["claude", join(home, ".claude", "local", "claude")];

  const extDir = join(home, ".vscode", "extensions");
  try {
    const vscodeBins = readdirSync(extDir)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      // Lexical sort puts the highest version last for zero-padded semver-ish dirs; good
      // enough to prefer the newest install without a real version parse.
      .sort()
      .reverse()
      .map((d) => join(extDir, d, "resources", "native-binary", "claude"));
    candidates.push(...vscodeBins);
  } catch {
    // ~/.vscode/extensions absent — nothing to add.
  }

  return candidates;
}

// Cache the first candidate whose `--version` succeeds. undefined = not yet probed.
let resolvedBin: string | null | undefined;

async function resolveClaudeBin(): Promise<string | null> {
  if (resolvedBin !== undefined) return resolvedBin;

  for (const bin of claudeCandidates()) {
    // Skip absolute paths that don't exist; "claude" (no slash) is resolved via PATH by execa.
    if (bin.includes("/") && !existsSync(bin)) continue;
    try {
      await execa(bin, ["--version"], { timeout: 10_000 });
      resolvedBin = bin;
      return bin;
    } catch {
      // Present but unusable (e.g. shim with no version) — try the next candidate.
    }
  }

  resolvedBin = null;
  return null;
}

// True when some usable `claude` binary was found. A successful `--version` is proof enough;
// we don't parse it because we only shell out to the stable `-p` (headless) interface.
export async function hasClaude(): Promise<boolean> {
  return (await resolveClaudeBin()) !== null;
}

export interface AppDetails {
  name: string;
  description: string;
  listingMd: string;
}

// Pull the JSON object out of Claude's stdout. Headless `claude -p` can wrap the object in a
// ```json fence and/or append trailing text (the user's global output style may add a footer),
// so we slice from the first "{" to the last "}" rather than trusting the whole string.
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}


// Ask Claude (headless) to invent the app name, a short description, and the app-store listing
// markdown from a plain-language goal. Returns null if Claude isn't usable / output unparseable.
export async function generateAppDetails(
  goal: string,
): Promise<AppDetails | null> {
  const prompt = [
    "You are naming and writing the marketplace listing for a new Peek Pro app.",
    "Audience: Peek Pro operators (tour/activity businesses) browsing the app marketplace.",
    "",
    "The operator described what the app should do:",
    goal,
    "",
    "Produce:",
    '- "name": a short, catchy product name (Title Case, 1-5 words, no "Peek", no punctuation).',
    '- "description": a plain-text summary of exactly 1 sentence. No markdown, no line breaks.',
    '- "listing_md": the listing body as GitHub-flavored Markdown — a bold one-line hook, then',
    "  short sections with headings and bullets. Sell the concrete value of THIS goal; do not",
    "  invent features it doesn't imply.",
    "",
    'Output ONLY a JSON object: {"name": "...", "description": "...", "listing_md": "..."}.',
    "No preamble, no code fence.",
  ].join("\n");

  const bin = await resolveClaudeBin();
  if (!bin) return null;

  try {
    // -p runs headless (print result, no TUI). We capture stdout and write files ourselves,
    // so Claude never needs tool permissions. Pin Haiku — naming + copy is a cheap writing task.
    const { stdout } = await execa(bin, ["-p", prompt, "--model", "haiku"], {
      timeout: 120_000,
    });

    const jsonStr = extractJsonObject(stdout);
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr) as {
      name?: unknown;
      description?: unknown;
      listing_md?: unknown;
    };
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";
    const listingMd =
      typeof parsed.listing_md === "string" ? parsed.listing_md.trim() : "";
    if (!name || !description || !listingMd) return null;

    return { name, description, listingMd };
  } catch {
    return null;
  }
}

// Write the generated copy to LISTING.md in the new app.
//
// This deliberately does NOT go into app.json. A manifest describes the BUILD — which
// extendables it uses and which platforms it runs on — and carries no name, description,
// icon or store copy. That is listing content, it is per platform (the same build can read
// differently on PeekPRO and on ACME), and it is written and reviewed in the portal under
// Apps → your app → Distribution. So the draft lands in a file the developer pastes from.
export async function writeListingDraft(
  targetDir: string,
  appName: string,
  details: Pick<AppDetails, "description" | "listingMd">,
): Promise<boolean> {
  const description = details.description.trim();
  const listingMd = details.listingMd.trim();
  if (!description && !listingMd) return false;

  const body = [
    `# ${appName} — listing draft`,
    "",
    "Store copy for this app, drafted at scaffold time. It lives here rather than in",
    "`app.json`: a listing is per platform and is written and reviewed in the portal",
    "(Apps → your app → Distribution). Paste it in there when you're ready to publish.",
    "",
    "## Short description",
    "",
    description,
    "",
    "## Listing",
    "",
    listingMd,
    "",
  ].join("\n");

  await writeFile(join(targetDir, "LISTING.md"), body, "utf8");
  return true;
}
