import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo, stubInstalledRepo } from "../helpers.js";
import { syncCommand } from "../../src/commands/sync.js";

test("sync: errors with no binding", async () => {
  const t = makeContext();
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
  }
});

test("sync: errors with bad manifest", async () => {
  const df = makeDotfilesRepo({ version: 999 });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: empty manifest → no-op success", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    // Only the dotfiles pull, no repo work.
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[0].opts.cwd, df.dir);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: profile-scoped manifest without active profile fails loudly", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    repos: [{ name: "work-tool", url: "u", profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.log.captured.some((l) => l.includes("no active profile")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: active profile filters apps repos and hooks", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    repos: [
      { name: "shared", url: "u1", update_cmd: "shared update" },
      { name: "work-tool", url: "u2", update_cmd: "work update", profiles: ["work"] },
      { name: "personal-tool", url: "u3", update_cmd: "personal update", profiles: ["personal"] },
    ],
    hooks: [
      { name: "shared-hook", stage: "post-repos", cmd: "shared hook", interactive: false },
      { name: "work-hook", stage: "post-repos", cmd: "work hook", interactive: false, profiles: ["work"] },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  stubInstalledRepo(join(t.homeDir, "repos"), "shared");
  stubInstalledRepo(join(t.homeDir, "repos"), "work-tool");
  stubInstalledRepo(join(t.homeDir, "repos"), "personal-tool");
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), [
      "git pull --ff-only",
      "shared update",
      "work update",
      "shared hook",
      "work hook",
    ]);
    assert.ok(t.log.captured.some((l) => l.includes("profile: work (binding)")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: --profile is a validated one-shot override", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    repos: [{ name: "work-tool", url: "u", update_cmd: "work update", profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "work-tool");
  try {
    const code = await syncCommand(t.ctx, { yes: true, profile: "work" });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "work update"]);
    assert.ok(t.log.captured.some((l) => l.includes("profile: work (override)")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: invalid local profile fails before applying plan", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    repos: [{ name: "work-tool", url: "u", profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "personal" });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
    assert.equal(t.runner.calls.length, 1);
    assert.ok(t.log.captured.some((l) => l.includes("Unknown profile")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: clones missing repo and runs install_cmd", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "https://x/tool-alpha.git", install_cmd: "npm install" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  // Configure mock runner to "succeed" for git clone + npm install.
  t.runner.respond("git clone", { code: 0 });
  t.runner.respond("npm install", { code: 0 });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.equal(t.runner.calls.length, 3);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[0].opts.cwd, df.dir);
    assert.match(t.runner.calls[1].command, /^git clone https:\/\/x\/tool-alpha\.git/);
    assert.equal(t.runner.calls[2].command, "npm install");
    // install_cmd runs in the cloned repo's targetDir.
    assert.equal(t.runner.calls[2].opts.cwd, join(t.homeDir, "repos", "tool-alpha"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: existing repo with update_cmd → runs update_cmd only", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{
      name: "tool-alpha",
      url: "https://x/tool-alpha.git",
      install_cmd: "npm install",
      update_cmd: "tool-alpha update",
    }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-alpha");
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.equal(t.runner.calls.length, 2);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[1].command, "tool-alpha update");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: existing repo without update_cmd → git pull + install_cmd", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-beta", url: "u", install_cmd: "build.ps1" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-beta");
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.deepEqual(
      t.runner.calls.map((c) => c.command),
      ["git pull --ff-only", "git pull --ff-only", "build.ps1"],
    );
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: existing repo without update_cmd skips install_cmd when git pull is already up to date", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-beta", url: "u", install_cmd: "build.ps1" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-beta");
  t.runner.respond("git pull", { code: 0, stdout: "Already up to date.\n" });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "git pull --ff-only"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: monorepo install/build/link runs in the configured subfolder", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{
      name: "tool-suite",
      url: "u",
      install_cmd: "npm install && npm run build && npm link",
      install_cwd: "cli",
    }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  // Mock clone success but pre-create the install_cwd subdir so cwd path resolves.
  t.runner.respond("git clone", { code: 0 });
  t.runner.respond("npm install && npm run build && npm link", { code: 0 });
  // We can't really pre-create after clone — just ensure the call records the right cwd.
  // (The real RealProcessRunner doesn't validate cwd existence.)
  mkdirSync(join(t.homeDir, "repos", "tool-suite", "cli"), { recursive: true });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    // exists=true now, so the action becomes pull-and-install (not clone).
    assert.equal(code, 0);
    const installCall = t.runner.calls.find((c) => c.command === "npm install && npm run build && npm link");
    assert.ok(installCall);
    assert.ok(installCall!.opts.cwd?.endsWith(join("tool-suite", "cli")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: confirmation declined aborts before exec", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir, promptAnswers: [false] });
  try {
    const code = await syncCommand(t.ctx, {});
    assert.equal(code, 0);
    // Dotfiles pull still runs (before plan), but no repo work after decline.
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.log.captured.some((l) => l.includes("Aborted")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: failure in one repo does not block others, returns 1", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [
      { name: "ok", url: "u1", install_cmd: "ok-cmd" },
      { name: "bad", url: "u2", install_cmd: "bad-cmd" },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git clone u1", { code: 0 });
  t.runner.respond("ok-cmd", { code: 0 });
  t.runner.respond("git clone u2", { code: 0 });
  t.runner.respond("bad-cmd", { fail: true, code: 5 });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
    // Both clone calls happened (failure didn't abort the second repo).
    const cloneCalls = t.runner.calls.filter((c) => c.command.startsWith("git clone"));
    assert.equal(cloneCalls.length, 2);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: filters by repo name args, errors on unknown name", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await syncCommand(t.ctx, { yes: true, repos: ["nope"] });
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.toLowerCase().includes("unknown")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: app stage is skipped on non-win32 with a recorded failure entry", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "Git.Git" }],
  });
  const t = makeContext({ preBoundTo: df.dir, platform: "darwin" });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
    // Dotfiles pull + no real winget call attempted on darwin — the result is recorded as a failure.
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.log.captured.some((l) => l.toLowerCase().includes("win32")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: winget install runs on win32 and treats already-installed as success", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "Git.Git" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("winget list", {
    code: 0,
    stdout: "No installed package found matching input criteria.\n",
  });
  t.runner.respond("winget install", {
    code: 1,
    stdout: "An existing package is already installed.",
  });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.equal(t.runner.calls.length, 3);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.match(t.runner.calls[1].command, /winget list --exact --id Git\.Git/);
    assert.match(t.runner.calls[2].command, /winget install --exact --id Git\.Git/);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: winget skips install when package is already installed", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "Git.Git" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("winget list", {
    code: 0,
    stdout: "Name           Id       Version\nGit for Windows Git.Git 2.49.0\n",
  });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "winget list --exact --id Git.Git"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: full sync runs post-repo hook interactively", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-sync", url: "u", install_cmd: "npm install", update_cmd: "tool-sync update" }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: true }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-sync");
  t.runner.respond("tool-sync update", { code: 0 });
  t.runner.respond("configsync sync", { code: 0 });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "tool-sync update", "configsync sync"]);
    assert.equal(t.runner.calls[2].opts.cwd, df.dir);
    assert.equal(t.runner.calls[2].opts.inherit, true);
    assert.equal(t.runner.calls[2].opts.interactive, true);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: targeted repo sync skips hooks unless explicitly requested", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-sync", url: "u", install_cmd: "npm install", update_cmd: "tool-sync update" }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: true }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-sync");
  try {
    const code = await syncCommand(t.ctx, { yes: true, repos: ["tool-sync"] });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "tool-sync update"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: targeted repo sync can opt into hooks", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-sync", url: "u", install_cmd: "npm install", update_cmd: "tool-sync update" }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: true }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-sync");
  t.runner.respond("configsync sync", { code: 0 });
  try {
    const code = await syncCommand(t.ctx, { yes: true, repos: ["tool-sync"], hooks: true });
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "tool-sync update", "configsync sync"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("sync: repo failure skips hooks", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-sync", url: "u", install_cmd: "npm install", update_cmd: "tool-sync update" }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: true }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-sync");
  t.runner.respond("tool-sync update", { fail: true, code: 1 });
  try {
    const code = await syncCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only", "tool-sync update"]);
    assert.ok(t.log.captured.some((l) => l.includes("skipped after earlier repo failure")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
