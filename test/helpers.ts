import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarshalContext } from "../src/context.js";
import { Platform } from "../src/platform.js";
import { MockProcessRunner } from "../src/runners/mock.js";
import { CaptureLogger } from "../src/ui/log.js";
import { CannedPrompter } from "../src/ui/prompt.js";

// Test fixtures and helpers. Each test that mutates the filesystem should
// pair makeSandbox() with a try/finally that calls cleanup() so the tmp
// dir is released even when assertions throw.

export interface TestContext {
  ctx: MarshalContext;
  runner: MockProcessRunner;
  log: CaptureLogger;
  prompt: CannedPrompter;
  homeDir: string;
  cleanup: () => void;
}

export interface MakeContextOptions {
  platform?: Platform;
  cwd?: string;
  promptAnswers?: boolean[];
  marshalSourceDir?: string;
  // If provided, the binding file is pre-written with this dotfilesRepo path.
  preBoundTo?: string;
  preBoundProfile?: string;
}

export function makeContext(opts: MakeContextOptions = {}): TestContext {
  const homeDir = mkdtempSync(join(tmpdir(), "marshal-ctx-"));
  const runner = new MockProcessRunner();
  const log = new CaptureLogger();
  const prompt = new CannedPrompter(opts.promptAnswers ?? []);
  const bindingPath = join(homeDir, ".marshal.json");
  if (opts.preBoundTo) {
    writeFileSync(
      bindingPath,
      JSON.stringify({
        version: 1,
        dotfilesRepo: opts.preBoundTo,
        ...(opts.preBoundProfile ? { profile: opts.preBoundProfile } : {}),
      }, null, 2),
      "utf8",
    );
  }
  const ctx: MarshalContext = {
    homeDir,
    bindingPath,
    marshalSourceDir: opts.marshalSourceDir ?? homeDir,
    platform: opts.platform ?? "win32",
    runner,
    log,
    prompt,
    cwd: opts.cwd ?? homeDir,
  };
  return {
    ctx,
    runner,
    log,
    prompt,
    homeDir,
    cleanup: () => {
      try {
        rmSync(homeDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

// Build a fake "dotfiles repo" directory containing a marshal.json with the
// given contents. Returns the absolute path of the directory.
export function makeDotfilesRepo(manifest: Record<string, unknown>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "marshal-dotfiles-"));
  writeFileSync(join(dir, "marshal.json"), JSON.stringify(manifest, null, 2), "utf8");
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

// Stub a "cloned tool repo" directory at <reposPath>/<name>/ so plan logic
// can detect it as exists=true.
export function stubInstalledRepo(reposPath: string, name: string): string {
  const dir = join(reposPath, name);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}
