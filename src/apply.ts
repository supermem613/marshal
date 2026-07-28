import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MarshalContext } from "./context.js";
import { Plan, RepoStep, AppStep, NpmStep, HookStep, SetupStep } from "./plan.js";
import { ExecutionResult } from "./render.js";
import { ProcessError } from "./runners/types.js";

// Apply a Plan: install apps in order, then provision repos sequentially.
// Each step's pass/fail is captured in the returned ExecutionResult[]; one
// failed step does not abort subsequent steps (so the user sees every
// failure in one run, not just the first).

export interface ApplyOptions {
  // Skip apps stage entirely (e.g., when caller knows winget is unavailable).
  skipApps?: boolean;
  // Skip the global npm packages stage entirely.
  skipNpm?: boolean;
  skipHooks?: boolean;
  // Skip the one-time setup stage. Setup steps only appear in the plan when
  // `marshal setup` opts in, so this is mostly a test bypass.
  skipSetup?: boolean;
}

export async function applyPlan(
  ctx: MarshalContext,
  plan: Plan,
  opts: ApplyOptions = {},
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  // Setup runs first so authentications complete before any clone or install
  // that depends on them.
  if (!opts.skipSetup && plan.setup.length > 0) {
    for (const step of plan.setup) {
      results.push(await runSetupStep(ctx, step));
    }
  }

  if (!opts.skipApps && plan.apps.length > 0) {
    for (const app of plan.apps) {
      results.push(await installApp(ctx, app));
    }
  }

  if (!opts.skipNpm && plan.npm.length > 0) {
    for (const pkg of plan.npm) {
      results.push(await installNpmPackage(ctx, pkg));
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
      skipped: true,
      detail: `winget not available on ${ctx.platform}`,
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

async function installNpmPackage(ctx: MarshalContext, pkg: NpmStep): Promise<ExecutionResult> {
  const queryCmd = `npm ls --global --depth=0 ${pkg.name}`;
  ctx.log.info(`→ ${queryCmd}`);
  try {
    const query = await ctx.runner.exec(queryCmd, {
      cwd: ctx.cwd,
      inherit: false,
      allowNonZero: true,
    });
    // `npm ls --global --depth=0 <name>` lists `<name>@<version>` when the
    // package is present. The exit code is unreliable: npm returns non-zero on
    // unrelated global-tree problems (ELSPROBLEMS, peer-dep gaps) even when the
    // queried package is installed. Match the listed package, not the exit code.
    if (new RegExp(`(^|\\s)${escapeRegExp(pkg.name)}@`, "m").test(query.stdout)) {
      return { step: `npm: ${pkg.name}`, ok: true, detail: "already installed" };
    }
  } catch {
    // Fall through to install. A failed preflight should not block provisioning.
  }
  const cmd = `npm install --global ${pkg.name}`;
  ctx.log.info(`→ ${cmd}`);
  try {
    const r = await ctx.runner.exec(cmd, { cwd: ctx.cwd, inherit: false, allowNonZero: true });
    if (r.code === 0) {
      return { step: `npm: ${pkg.name}`, ok: true, detail: "installed" };
    }
    return {
      step: `npm: ${pkg.name}`,
      ok: false,
      detail: `npm exit ${r.code}: ${(r.stderr || r.stdout).split("\n")[0].slice(0, 200)}`,
    };
  } catch (err) {
    return {
      step: `npm: ${pkg.name}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function runSetupStep(ctx: MarshalContext, step: SetupStep): Promise<ExecutionResult> {
  // check_cmd is the idempotency oracle. Exit 0 means the step is already
  // satisfied, so we skip the (often interactive) run. Steps without a
  // check_cmd always run.
  if (step.checkCmd) {
    ctx.log.info(`→ ${step.checkCmd}`);
    try {
      const check = await ctx.runner.exec(step.checkCmd, {
        cwd: step.cwd,
        inherit: false,
        allowNonZero: true,
      });
      if (check.code === 0) {
        return { step: `setup: ${step.name}`, ok: true, skipped: true, detail: "already satisfied" };
      }
    } catch {
      // A failed check is not authoritative — fall through and run the step.
    }
  }
  ctx.log.info(`→ (${step.cwd}) ${step.command}`);
  try {
    const result = await ctx.runner.exec(step.command, {
      cwd: step.cwd,
      inherit: step.interactive,
      interactive: step.interactive,
    });
    const detail = step.interactive
      ? "completed"
      : (result.stdout || result.stderr).trim().split("\n")[0] || "completed";
    return { step: `setup: ${step.name}`, ok: true, detail };
  } catch (err) {
    if (err instanceof ProcessError) {
      const output = (err.result.stderr || err.result.stdout).trim().split("\n")[0];
      const detail = output || `command failed (exit ${err.result.code})`;
      return { step: `setup: ${step.name}`, ok: false, detail };
    }
    return { step: `setup: ${step.name}`, ok: false, detail: (err as Error).message };
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
      await ctx.backendFor(repo.vcs).clone(ctx, repo.url, repo.targetDir);
      requireInstallCwd(repo);
      ctx.log.info(`→ (${repo.installCwd}) ${repo.installCmd}`);
      await ctx.runner.exec(repo.installCmd as string, { cwd: repo.installCwd, inherit: false });
      return { step: `repo: ${repo.name}`, ok: true, detail: "cloned + installed" };
    }
    if (repo.action === "clone") {
      mkdirSync(dirname(repo.targetDir), { recursive: true });
      ctx.log.info(`→ git clone ${repo.url} ${repo.targetDir}`);
      await ctx.backendFor(repo.vcs).clone(ctx, repo.url, repo.targetDir);
      return { step: `repo: ${repo.name}`, ok: true, detail: "cloned" };
    }
    if (repo.action === "update") {
      requireInstallCwd(repo);
      ctx.log.info(`→ (${repo.installCwd}) ${repo.updateCmd}`);
      await ctx.runner.exec(repo.updateCmd as string, { cwd: repo.installCwd, inherit: false });
      return { step: `repo: ${repo.name}`, ok: true, detail: "updated" };
    }
    // pull-and-install or pull
    ctx.log.info(`→ (${repo.targetDir}) git pull --ff-only`);
    const pull = await ctx.backendFor(repo.vcs).pull(ctx, repo.targetDir);
    if (!pull.changed) {
      return { step: `repo: ${repo.name}`, ok: true, detail: "already up to date" };
    }
    if (!repo.installCmd) {
      return { step: `repo: ${repo.name}`, ok: true, detail: "pulled" };
    }
    // Checked after the pull, since the pull can be what creates install_cwd.
    requireInstallCwd(repo);
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

// Spawning with a cwd that does not exist reports ENOENT against the shell
// binary, not against the directory. On Windows that surfaces as
// "spawn C:\WINDOWS\system32\cmd.exe ENOENT", which sends readers hunting for a
// missing cmd.exe. Fail here instead so the message names install_cwd.
function requireInstallCwd(repo: RepoStep): void {
  if (existsSync(repo.installCwd)) {
    return;
  }
  throw new Error(
    `install_cwd does not exist: ${repo.installCwd}. ` +
    `Check the "install_cwd" field of repo "${repo.name}" in marshal.json. ` +
    `It must be a subdirectory inside the repo, not a command.`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
