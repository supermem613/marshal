import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { makeContext } from "../helpers.js";
import { applyPlan } from "../../src/apply.js";
import { Plan } from "../../src/plan.js";

// --- installApp: platform skipping ---

test("applyPlan: apps are skipped on darwin and recorded as non-ok", async () => {
  const t = makeContext({ platform: "darwin" });
  try {
    const plan: Plan = {
      apps: [{ id: "dandavison.delta" }, { id: "jqlang.jq" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "darwin",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.equal(r.ok, false);
      assert.equal(r.skipped, true);
      assert.ok(r.detail?.includes("winget not available on darwin"));
    }
    // No commands should be executed for skipped apps
    assert.equal(t.runner.calls.length, 0);
  } finally {
    t.cleanup();
  }
});

test("applyPlan: skipped non-win apps are recorded as non-ok results", async () => {
  const t = makeContext({ platform: "darwin" });
  try {
    const plan: Plan = {
      apps: [{ id: "Git.Git" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "darwin",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(results[0].skipped, true);
    assert.ok(results[0].detail?.includes("winget not available on darwin"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: apps are skipped on linux and recorded as non-ok", async () => {
  const t = makeContext({ platform: "linux" });
  try {
    const plan: Plan = {
      apps: [{ id: "Git.Git" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "linux",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(results[0].skipped, true);
    assert.ok(results[0].detail?.includes("linux"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: apps are installed on win32", async () => {
  const t = makeContext({ platform: "win32" });
  // winget list says not found, winget install succeeds
  t.runner.respond(/^winget list/, { stdout: "No installed package found matching input criteria.", code: 0 });
  t.runner.respond(/^winget install/, { code: 0, stdout: "Successfully installed" });
  try {
    const plan: Plan = {
      apps: [{ id: "jqlang.jq" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].skipped, undefined);
    assert.equal(results[0].detail, "installed");
  } finally {
    t.cleanup();
  }
});

test("applyPlan: app already installed on win32 via preflight", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond(/^winget list/, { code: 0, stdout: "Name          Id              Version\n---\ndelta         dandavison.delta 0.16.5" });
  try {
    const plan: Plan = {
      apps: [{ id: "dandavison.delta" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].detail, "already installed");
  } finally {
    t.cleanup();
  }
});

test("applyPlan: app install fails on win32", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond(/^winget list/, { stdout: "No installed package found matching input criteria.", code: 0 });
  t.runner.respond(/^winget install/, { code: 1, stdout: "", stderr: "Package not found" });
  try {
    const plan: Plan = {
      apps: [{ id: "fake.package" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.ok(results[0].detail?.includes("winget exit 1"));
  } finally {
    t.cleanup();
  }
});

// --- installNpmPackage ---

test("applyPlan: npm package installed when missing (cross-platform)", async () => {
  const t = makeContext({ platform: "darwin" });
  t.runner.respond(/^npm ls/, { code: 1, stdout: "" });
  t.runner.respond(/^npm install/, { code: 0, stdout: "added 1 package" });
  try {
    const plan: Plan = {
      apps: [],
      npm: [{ name: "typescript" }],
      repos: [],
      hooks: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "darwin",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].step, "npm: typescript");
    assert.equal(results[0].ok, true);
    assert.equal(results[0].detail, "installed");
  } finally {
    t.cleanup();
  }
});

test("applyPlan: npm package already installed short-circuits before install", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond(/^npm ls/, { code: 0, stdout: "C:\\npm\n`-- typescript@5.7.0" });
  try {
    const plan: Plan = {
      apps: [],
      npm: [{ name: "typescript" }],
      repos: [],
      hooks: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].detail, "already installed");
    // Only the preflight `npm ls` should have run, no install.
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.runner.calls[0].command.startsWith("npm ls"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: npm package present but npm ls exits non-zero still short-circuits", async () => {
  const t = makeContext({ platform: "win32" });
  // npm ls returns non-zero on unrelated ELSPROBLEMS in the global tree while
  // still listing the queried package. Marshal must not reinstall in that case.
  t.runner.respond(/^npm ls/, { code: 1, stdout: "C:\\npm\n`-- typescript@5.7.0\n`-- UNMET PEER DEPENDENCY other@1.0.0" });
  try {
    const plan: Plan = {
      apps: [],
      npm: [{ name: "typescript" }],
      repos: [],
      hooks: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].detail, "already installed");
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.runner.calls[0].command.startsWith("npm ls"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: npm install failure is recorded as non-ok", async () => {
  const t = makeContext({ platform: "linux" });
  t.runner.respond(/^npm ls/, { code: 1, stdout: "" });
  t.runner.respond(/^npm install/, { code: 1, stdout: "", stderr: "E404 Not Found" });
  try {
    const plan: Plan = {
      apps: [],
      npm: [{ name: "does-not-exist" }],
      repos: [],
      hooks: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "linux",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.ok(results[0].detail?.includes("npm exit 1"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: skipNpm option bypasses npm packages", async () => {
  const t = makeContext({ platform: "win32" });
  try {
    const plan: Plan = {
      apps: [],
      npm: [{ name: "typescript" }],
      repos: [],
      hooks: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan, { skipNpm: true });
    assert.equal(results.length, 0);
    assert.equal(t.runner.calls.length, 0);
  } finally {
    t.cleanup();
  }
});

// --- skipApps option ---

test("applyPlan: skipApps option bypasses all apps", async () => {
  const t = makeContext({ platform: "win32" });
  try {
    const plan: Plan = {
      apps: [{ id: "Git.Git" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan, { skipApps: true });
    assert.equal(results.length, 0);
    assert.equal(t.runner.calls.length, 0);
  } finally {
    t.cleanup();
  }
});

// --- skipped apps don't count as failures for hooks ---

test("applyPlan: skipped apps do not prevent hooks from running", async () => {
  const t = makeContext({ platform: "darwin" });
  t.runner.respond("echo", { code: 0, stdout: "hook output" });
  try {
    const plan: Plan = {
      apps: [{ id: "dandavison.delta" }],
      repos: [],
      hooks: [{
        name: "my-hook",
        stage: "post-repos",
        command: "echo hello",
        cwd: t.homeDir,
        interactive: false,
      }],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "darwin",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    // 1 skipped app + 1 successful hook
    assert.equal(results.length, 2);
    assert.equal(results[0].skipped, true);
    assert.equal(results[1].ok, true);
    assert.equal(results[1].step, "hook: my-hook");
  } finally {
    t.cleanup();
  }
});

test("applyPlan: multiple apps skipped still yields correct step names", async () => {
  const t = makeContext({ platform: "darwin" });
  try {
    const plan: Plan = {
      apps: [{ id: "A.A" }, { id: "B.B" }, { id: "C.C" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [],
      reposPath: join(t.homeDir, "repos"),
      platform: "darwin",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 3);
    assert.deepEqual(results.map((r) => r.step), ["app: A.A", "app: B.B", "app: C.C"]);
    assert.ok(results.every((r) => r.skipped === true));
  } finally {
    t.cleanup();
  }
});

// --- mixed-vcs fleet routing ---

test("applyPlan: mixed fleet routes each repo through its declared vcs", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond(/^git clone/, { code: 0 });
  t.runner.respond(/^sd clone/, { code: 0 });
  try {
    const reposPath = join(t.homeDir, "repos");
    const gitDir = join(reposPath, "git-tool");
    const sdDir = join(reposPath, "sd-tool");
    const plan: Plan = {
      apps: [],
      npm: [],
      hooks: [],
      setup: [],
      repos: [
        {
          name: "git-tool",
          url: "https://x/git-tool.git",
          targetDir: gitDir,
          installCwd: gitDir,
          installCmd: null,
          updateCmd: null,
          action: "clone",
          exists: false,
          vcs: "git",
        },
        {
          name: "sd-tool",
          url: "https://x/sd-tool.git",
          targetDir: sdDir,
          installCwd: sdDir,
          installCmd: null,
          updateCmd: null,
          action: "clone",
          exists: false,
          vcs: "soda",
        },
      ],
      reposPath,
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    const cloneCmds = t.runner.calls.map((c) => c.command).filter((c) => c.includes("clone"));
    assert.deepEqual(cloneCmds, [
      `git clone https://x/git-tool.git "${gitDir}"`,
      `sd clone https://x/sd-tool.git "${sdDir}"`,
    ]);
  } finally {
    t.cleanup();
  }
});

// --- setup steps ---

function setupPlan(t: ReturnType<typeof makeContext>, setup: Plan["setup"]): Plan {
  return {
    apps: [],
    repos: [],
    hooks: [],
    npm: [],
    setup,
    reposPath: join(t.homeDir, "repos"),
    platform: t.ctx.platform,
    activeProfile: { profile: null, source: "none" },
  };
}

test("applyPlan: setup step with satisfied check_cmd is skipped before running", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond("gh auth status", { code: 0 });
  try {
    const plan = setupPlan(t, [
      { name: "gh-auth", command: "gh auth login", checkCmd: "gh auth status", cwd: t.homeDir, interactive: true },
    ]);
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].step, "setup: gh-auth");
    assert.equal(results[0].ok, true);
    assert.equal(results[0].skipped, true);
    assert.equal(results[0].detail, "already satisfied");
    // Only the check ran; the login command must not have executed.
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.runner.calls[0].command.startsWith("gh auth status"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: setup step runs its command when check_cmd is unsatisfied", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond("gh auth status", { code: 1 });
  t.runner.respond("gh auth login", { code: 0 });
  try {
    const plan = setupPlan(t, [
      { name: "gh-auth", command: "gh auth login", checkCmd: "gh auth status", cwd: t.homeDir, interactive: true },
    ]);
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].skipped, undefined);
    assert.equal(t.runner.calls.length, 2);
    assert.ok(t.runner.calls[1].command.startsWith("gh auth login"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: setup step without check_cmd always runs", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond("do-setup", { code: 0 });
  try {
    const plan = setupPlan(t, [
      { name: "always", command: "do-setup", checkCmd: null, cwd: t.homeDir, interactive: false },
    ]);
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.runner.calls[0].command.startsWith("do-setup"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: failed setup step is recorded and does not abort later stages", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond("bad-auth", { fail: true, code: 1, stderr: "auth boom" });
  t.runner.respond(/^npm ls/, { code: 0, stdout: "C:\\npm\n`-- typescript@5.7.0" });
  try {
    const plan: Plan = {
      apps: [],
      repos: [],
      hooks: [],
      npm: [{ name: "typescript" }],
      setup: [{ name: "auth", command: "bad-auth", checkCmd: null, cwd: t.homeDir, interactive: false }],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    const results = await applyPlan(t.ctx, plan);
    assert.equal(results.length, 2);
    assert.equal(results[0].step, "setup: auth");
    assert.equal(results[0].ok, false);
    // npm still ran after the setup failure.
    assert.equal(results[1].step, "npm: typescript");
    assert.equal(results[1].ok, true);
  } finally {
    t.cleanup();
  }
});

test("applyPlan: setup steps run before apps", async () => {
  const t = makeContext({ platform: "win32" });
  t.runner.respond("do-setup", { code: 0 });
  t.runner.respond(/^winget/, { code: 0, stdout: "No installed package found matching input criteria." });
  try {
    const plan: Plan = {
      apps: [{ id: "Git.Git" }],
      repos: [],
      hooks: [],
      npm: [],
      setup: [{ name: "first", command: "do-setup", checkCmd: null, cwd: t.homeDir, interactive: false }],
      reposPath: join(t.homeDir, "repos"),
      platform: "win32",
      activeProfile: { profile: null, source: "none" },
    };
    await applyPlan(t.ctx, plan);
    assert.ok(t.runner.calls[0].command.startsWith("do-setup"));
  } finally {
    t.cleanup();
  }
});

test("applyPlan: skipSetup bypasses setup steps", async () => {
  const t = makeContext({ platform: "win32" });
  try {
    const plan = setupPlan(t, [
      { name: "first", command: "do-setup", checkCmd: null, cwd: t.homeDir, interactive: false },
    ]);
    const results = await applyPlan(t.ctx, plan, { skipSetup: true });
    assert.equal(results.length, 0);
    assert.equal(t.runner.calls.length, 0);
  } finally {
    t.cleanup();
  }
});
