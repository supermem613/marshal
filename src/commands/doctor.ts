import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MarshalContext } from "../context.js";
import { readBinding } from "../binding.js";
import { readManifest, MANIFEST_FILENAME, ManifestError } from "../manifest.js";
import { ProcessError } from "../runners/types.js";

// CheckResult shape is the convention across rotunda/reflux/kash/sp-tools.
// Keep it stable: tooling and `--json` consumers depend on it.
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

function checkNode(): CheckResult {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 24) {
    return {
      name: "node",
      ok: false,
      detail: `Node ${process.versions.node} (need >=24)`,
      hint: "Install Node 24 or later from https://nodejs.org",
    };
  }
  return { name: "node", ok: true, detail: `Node ${process.versions.node}` };
}

async function checkExecutable(
  ctx: MarshalContext,
  bin: string,
  installHint: string,
): Promise<CheckResult> {
  // Prefer `--version`; fall back to plain invocation. allowNonZero so that
  // tools that print version on stderr or exit non-zero still register as
  // "installed" if their stdout contains a recognizable token.
  try {
    const r = await ctx.runner.exec(`${bin} --version`, { allowNonZero: true, cwd: ctx.cwd });
    if (r.code === 0 || r.stdout || r.stderr) {
      const line = (r.stdout || r.stderr).split("\n")[0].trim();
      return { name: bin, ok: true, detail: line || "installed" };
    }
    return { name: bin, ok: false, detail: `${bin} not found`, hint: installHint };
  } catch (err) {
    if (err instanceof ProcessError) {
      return { name: bin, ok: false, detail: err.message.split("\n")[0], hint: installHint };
    }
    return { name: bin, ok: false, detail: (err as Error).message, hint: installHint };
  }
}

function checkBinding(ctx: MarshalContext): CheckResult {
  try {
    const b = readBinding(ctx.homeDir);
    if (!b) {
      return {
        name: "binding",
        ok: false,
        detail: `No binding at ${ctx.bindingPath}`,
        hint: "Run `marshal bind <dotfiles-url-or-path>`",
      };
    }
    if (!existsSync(b.dotfilesRepo)) {
      return {
        name: "binding",
        ok: false,
        detail: `Bound path missing: ${b.dotfilesRepo}`,
        hint: "Re-bind with `marshal bind <correct-path>` or `marshal bind --unset`",
      };
    }
    return { name: "binding", ok: true, detail: b.dotfilesRepo };
  } catch (err) {
    return {
      name: "binding",
      ok: false,
      detail: (err as Error).message,
      hint: "Inspect ~/.marshal.json or run `marshal bind --unset` and re-bind",
    };
  }
}

function checkManifest(ctx: MarshalContext): CheckResult {
  const b = readBinding(ctx.homeDir);
  if (!b) {
    return { name: "manifest", ok: false, detail: "skipped (no binding)" };
  }
  const path = join(b.dotfilesRepo, MANIFEST_FILENAME);
  if (!existsSync(path)) {
    return {
      name: "manifest",
      ok: false,
      detail: `No ${MANIFEST_FILENAME} at ${path}`,
      hint: "Run `marshal init` inside the dotfiles repo",
    };
  }
  try {
    const m = readManifest(b.dotfilesRepo);
    return {
      name: "manifest",
      ok: true,
      detail: `${m.apps.length} app(s), ${m.repos.length} repo(s)`,
    };
  } catch (err) {
    if (err instanceof ManifestError) {
      return { name: "manifest", ok: false, detail: err.message, hint: "Fix the manifest JSON/schema errors" };
    }
    throw err;
  }
}

async function runChecks(ctx: MarshalContext): Promise<CheckResult[]> {
  const checks: Array<CheckResult | Promise<CheckResult>> = [
    checkNode(),
    checkExecutable(ctx, "git", "Install Git: winget install Git.Git"),
  ];
  if (ctx.platform === "win32") {
    checks.push(checkExecutable(ctx, "winget", "Install App Installer from the Microsoft Store"));
  }
  checks.push(checkBinding(ctx));
  checks.push(checkManifest(ctx));
  return Promise.all(checks);
}

export async function doctorCommand(ctx: MarshalContext, opts: { json?: boolean }): Promise<number> {
  const results = await runChecks(ctx);
  const allOk = results.every((r) => r.ok);

  if (opts.json) {
    ctx.log.raw(JSON.stringify({ ok: allOk, checks: results }, null, 2) + "\n");
    return allOk ? 0 : 1;
  }

  ctx.log.info(chalk.bold(`marshal doctor`));
  ctx.log.info("");
  for (const r of results) {
    const icon = r.ok ? chalk.green("✓") : chalk.red("✗");
    ctx.log.info(`  ${icon} ${r.name.padEnd(12, ".")} ${r.detail}`);
    if (!r.ok && r.hint) {
      ctx.log.info(`      ${chalk.dim(r.hint)}`);
    }
  }
  ctx.log.info("");
  if (allOk) {
    ctx.log.success("All checks passed.");
  } else {
    ctx.log.error("One or more checks failed.");
  }
  return allOk ? 0 : 1;
}
