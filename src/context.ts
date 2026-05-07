import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { Platform, detectPlatform } from "./platform.js";
import { ProcessRunner } from "./runners/types.js";
import { RealProcessRunner } from "./runners/real.js";
import { Logger, ConsoleLogger } from "./ui/log.js";
import { Prompter, StdinPrompter } from "./ui/prompt.js";
import { bindingPath } from "./binding.js";

// Single dependency-injection seam. Every command takes a MarshalContext as
// its first argument. Production wiring uses createDefaultContext(); tests
// build one with mock runner, sandboxed homeDir, capture logger.

export interface MarshalContext {
  homeDir: string;
  bindingPath: string;
  marshalSourceDir: string;
  platform: Platform;
  runner: ProcessRunner;
  log: Logger;
  prompt: Prompter;
  cwd: string;
}

// Resolve the on-disk source directory of the running marshal install.
// Used by `marshal home` and `marshal update` (self-update).
//
// dist/cli.js → ../.. = source root. realpathSync follows the npm-link
// symlink so we end up at the actual repo even when invoked through the
// global symlink.
export function resolveMarshalSourceDir(importMetaUrl: string): string {
  const distFile = realpathSync(fileURLToPath(importMetaUrl));
  // distFile = <root>/dist/<file>.js → up two levels.
  let candidate = dirname(dirname(distFile));
  // Tests import this from src/, not dist/. Tolerate that: walk up until we
  // find a package.json with name === "marshal", or stop at filesystem root.
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }
  return candidate;
}

export function createDefaultContext(importMetaUrl: string): MarshalContext {
  const home = homedir();
  return {
    homeDir: home,
    bindingPath: bindingPath(home),
    marshalSourceDir: resolveMarshalSourceDir(importMetaUrl),
    platform: detectPlatform(),
    runner: new RealProcessRunner(),
    log: new ConsoleLogger(),
    prompt: new StdinPrompter(),
    cwd: process.cwd(),
  };
}
