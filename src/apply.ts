import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MarshalContext } from "./context.js";
import { Plan, RepoStep, AppStep, HookStep } from "./plan.js";
import { ExecutionResult } from "./render.js";
import { ProcessError } from "./runners/types.js";
import { gitPullMadeNoChanges } from "./command-state.js";

// Apply a Plan: install apps in order, then provision repos sequentially.
// Each step's pass/fail is captured in the returned ExecutionResult[]; one
// failed step does not abort subsequent steps (so the user sees every
// failure in one run, not just the first).

export interface ApplyOptions {
  // Skip apps stage entirely (e.g., when caller knows winget is unavailable).
  skipApps?: boolean;
  skipHooks?: boolean;
}

export async function applyPlan(
  ctx: MarshalContext,
  plan: Plan,
  opts: ApplyOptions = {},
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  if (!opts.skipApps && plan.apps.length > 0) {
    for (const app of plan.apps) {
      results.push(await installApp(ctx, app));
    }
  }

  let repoFailed = false;
  for (const repo of plan.repos) {
    const result = await provisionRepo(ctx, repo);
    if (!result.ok) {
      repoFailed = true;
    }
    results.push(result);
  }

  if (!opts.skipHooks && plan.hooks.length > 0) {
    if (repoFailed) {
      for (const hook of plan.hooks) {
        results.push({
          step: `hook: ${hook.name}`,
          ok: false,
          detail: "skipped after earlier repo failure",
        });
      }
      return results;
    }
    for (const hook of plan.hooks) {
      results.push(await runHook(ctx, hook));
    }
  }

  return results;
}

async function installApp(ctx: MarshalContext, app: AppStep): Promise<ExecutionResult> {
  if (ctx.platform !== "win32") {
    return {
      step: `app: ${app.id}`,
      ok: false,
      detail: `apps stage only supported on win32 for v1 (current: ${ctx.platform})`,
    };
  }
  const queryCmd = `winget list --exact --id ${app.id}`;
  ctx.log.info(`→ ${queryCmd}`);
  try {
    const query = await ctx.runner.exec(queryCmd, {
      cwd: ctx.cwd,
      inherit: false,
      allowNonZero: true,
    });
    const queryOutput = `${query.stdout}\n${query.stderr}`;
    if (!/No installed package found matching input criteria\./i.test(queryOutput)
      && new RegExp(`(^|\\s)${escapeRegExp(app.id)}(\\s|$)`, "m").test(queryOutput)) {
      return { step: `app: ${app.id}`, ok: true, detail: "already installed" };
    }
  } catch {
    // Fall through to install. A failed preflight should not block provisioning.
  }
  const cmd = `winget install --exact --id ${app.id} --accept-source-agreements --accept-package-agreements --silent`;
  ctx.log.info(`→ ${cmd}`);
  try {
    // winget exits non-zero when a package is already installed (-1978335189
    // / 0x8A150019). allowNonZero so we can inspect rather than abort.
    const r = await ctx.runner.exec(cmd, { cwd: ctx.cwd, inherit: false, allowNonZero: true });
    if (r.code === 0) {
      return { step: `app: ${app.id}`, ok: true, detail: "installed" };
    }
    // Treat "already installed" as success.
    if (/already installed/i.test(r.stdout) || /already installed/i.test(r.stderr)) {
      return { step: `app: ${app.id}`, ok: true, detail: "already installed" };
    }
    return {
      step: `app: ${app.id}`,
      ok: false,
      detail: `winget exit ${r.code}: ${(r.stderr || r.stdout).split("\n")[0].slice(0, 200)}`,
    };
  } catch (err) {
    return {
      step: `app: ${app.id}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function runHook(ctx: MarshalContext, hook: HookStep): Promise<ExecutionResult> {
  ctx.log.info(`→ (${hook.cwd}) ${hook.command}`);
  try {
    const result = await ctx.runner.exec(hook.command, {
      cwd: hook.cwd,
      inherit: hook.interactive,
      interactive: hook.interactive,
    });
    const detail = hook.interactive
      ? "completed"
      : (result.stdout || result.stderr).trim().split("\n")[0] || "completed";
    return { step: `hook: ${hook.name}`, ok: true, detail };
  } catch (err) {
    if (err instanceof ProcessError) {
      const output = (err.result.stderr || err.result.stdout).trim().split("\n")[0];
      const detail = output || `command failed (exit ${err.result.code})`;
      return { step: `hook: ${hook.name}`, ok: false, detail };
    }
    return { step: `hook: ${hook.name}`, ok: false, detail: (err as Error).message };
  }
}

async function provisionRepo(ctx: MarshalContext, repo: RepoStep): Promise<ExecutionResult> {
  try {
    if (repo.action === "clone-and-install") {
      mkdirSync(dirname(repo.targetDir), { recursive: true });
      ctx.log.info(`→ git clone ${repo.url} ${repo.targetDir}`);
      await ctx.runner.exec(`git clone ${repo.url} "${repo.targetDir}"`, { cwd: ctx.cwd, inherit: false });
      ctx.log.info(`→ (${repo.installCwd}) ${repo.installCmd}`);
      await ctx.runner.exec(repo.installCmd, { cwd: repo.installCwd, inherit: false });
      return { step: `repo: ${repo.name}`, ok: true, detail: "cloned + installed" };
    }
    if (repo.action === "update") {
      ctx.log.info(`→ (${repo.installCwd}) ${repo.updateCmd}`);
      await ctx.runner.exec(repo.updateCmd as string, { cwd: repo.installCwd, inherit: false });
      return { step: `repo: ${repo.name}`, ok: true, detail: "updated" };
    }
    // pull-and-install
    ctx.log.info(`→ (${repo.targetDir}) git pull --ff-only`);
    const pull = await ctx.runner.exec(`git pull --ff-only`, { cwd: repo.targetDir, inherit: false });
    if (gitPullMadeNoChanges(pull)) {
      return { step: `repo: ${repo.name}`, ok: true, detail: "already up to date" };
    }
    ctx.log.info(`→ (${repo.installCwd}) ${repo.installCmd}`);
    await ctx.runner.exec(repo.installCmd, { cwd: repo.installCwd, inherit: false });
    return { step: `repo: ${repo.name}`, ok: true, detail: "pulled + reinstalled" };
  } catch (err) {
    const msg = err instanceof ProcessError
      ? `${err.message.split("\n")[0]}`
      : (err as Error).message;
    return { step: `repo: ${repo.name}`, ok: false, detail: msg };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
