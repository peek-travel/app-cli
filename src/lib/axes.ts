import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { PLATFORMS } from "./platforms.js";
import { STACKS } from "./stacks.js";

// The two axes an app is composed along — the platform it targets and the stack it's built
// on. They pick the starter kit's manifest and the skills that get composed into
// `.claude/skills`, so every command that touches either has to answer the same question.
//
// `peek init` asks them of an app that doesn't exist yet. `peek apps link` and `peek skills`
// ask them of a directory that already does — where the answer may already be recorded in
// `.peek-kit.json`, or derivable from the manifest the registry holds. Hence one resolution
// order, in one place: an explicit flag, then what the project already knows, then a
// prompt — and no prompt at all when there's only one option, or when nobody's watching.

interface AxisOptions {
  // What the axis is called in prose and in its flag ("platform" → --platform).
  name: string;
  question: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  // An explicit --platform / --stack. Always wins.
  provided?: string;
  // What this directory already recorded or we derived (e.g. from the app's manifest).
  recorded?: string;
}

async function chooseAxis(options: AxisOptions): Promise<string> {
  if (options.provided) return options.provided;
  if (options.recorded) return options.recorded;

  // One choice is not a question. This is the normal case for `stack` today (JavaScript is
  // the only kit), and keeping it silent means a linked project isn't quizzed about it.
  if (options.choices.length === 1) return options.choices[0].value;

  if (!process.stdin.isTTY) {
    throw new CLIError(
      `Can't work out which ${options.name} this app targets.`,
      `Pass --${options.name} <${options.choices.map((c) => c.value).join("|")}>.`,
    );
  }

  const answer = await p.select({
    message: options.question,
    options: options.choices.map((choice) => ({ value: choice.value, label: choice.label })),
  });

  if (p.isCancel(answer)) {
    p.cancel("Cancelled");
    throw new CLIError("Aborted.");
  }

  return answer as string;
}

export function resolvePlatform(provided?: string, recorded?: string): Promise<string> {
  return chooseAxis({
    name: "platform",
    question: "Which platform are you developing for?",
    choices: PLATFORMS,
    provided,
    recorded,
  });
}

export function resolveStack(provided?: string, recorded?: string): Promise<string> {
  return chooseAxis({
    name: "stack",
    question: "Which tech stack do you want to build on?",
    choices: STACKS,
    provided,
    recorded,
  });
}
