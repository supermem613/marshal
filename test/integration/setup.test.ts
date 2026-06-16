import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo, stubInstalledRepo } from "../helpers.js";
import { setupCommand } from "../../src/commands/setup.js";
import { readBinding } from "../../src/binding.js";

test("setup: errors with no binding", async () => {
  const t = makeContext();
  try {
    const code = await setupCommand(t.ctx, { yes: true });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
  }
});

test("setup: --profile writes binding then runs setup steps before repos", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    setup: [{ name: "gh-auth", cmd: "gh-auth-login", check_cmd: "gh-auth-status", profiles: ["work"] }],
    repos: [{ name: "work-tool", url: "u", update_cmd: "work-update", profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "work-tool");
  t.runner.respond("gh-auth-status", { code: 1 });
  t.runner.respond("gh-auth-login", { code: 0 });
  t.runner.respond("work-update", { code: 0 });
  try {
    const code = await setupCommand(t.ctx, { yes: true, profile: "work" });
    assert.equal(code, 0);
    assert.equal(readBinding(t.homeDir)?.profile, "work");
    const commands = t.runner.calls.map((c) => c.command);
    // setup pulls dotfiles, sync pulls again, then setup steps (check then run)
    // precede the repo update.
    assert.deepEqual(commands, [
      "git pull --ff-only",
      "git pull --ff-only",
      "gh-auth-status",
      "gh-auth-login",
      "work-update",
    ]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("setup: interactively selects a profile and writes it to the binding", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    setup: [{ name: "gh-auth", cmd: "gh-auth-login", check_cmd: "gh-auth-status" }],
  });
  const t = makeContext({ preBoundTo: df.dir, promptSelections: ["personal"] });
  t.runner.respond("gh-auth-status", { code: 0 });
  try {
    const code = await setupCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    assert.equal(readBinding(t.homeDir)?.profile, "personal");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("setup: satisfied check_cmd skips the setup command", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    setup: [{ name: "gh-auth", cmd: "gh-auth-login", check_cmd: "gh-auth-status" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("gh-auth-status", { code: 0 });
  try {
    const code = await setupCommand(t.ctx, { yes: true });
    assert.equal(code, 0);
    const commands = t.runner.calls.map((c) => c.command);
    assert.ok(commands.includes("gh-auth-status"));
    assert.ok(!commands.includes("gh-auth-login"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("setup: --no-sync stops after writing the profile", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    setup: [{ name: "gh-auth", cmd: "gh-auth-login" }],
    repos: [{ name: "work-tool", url: "u", update_cmd: "work-update", profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await setupCommand(t.ctx, { yes: true, profile: "work", sync: false });
    assert.equal(code, 0);
    assert.equal(readBinding(t.homeDir)?.profile, "work");
    // Only the dotfiles pull; no setup or repo work without sync.
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("setup: --status reports satisfied and pending steps without running them", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    setup: [
      { name: "gh-auth", cmd: "gh-auth-login", check_cmd: "gh-auth-status" },
      { name: "az-login", cmd: "az-login-cmd", check_cmd: "az-account-show" },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("gh-auth-status", { code: 0 });
  t.runner.respond("az-account-show", { code: 1 });
  try {
    const code = await setupCommand(t.ctx, { status: true });
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes("gh-auth") && l.includes("satisfied")));
    assert.ok(t.log.captured.some((l) => l.includes("az-login") && l.includes("pending")));
    // Status must never run the actual setup commands.
    const commands = t.runner.calls.map((c) => c.command);
    assert.ok(!commands.includes("gh-auth-login"));
    assert.ok(!commands.includes("az-login-cmd"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("setup: unknown --profile fails before writing the binding", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    setup: [{ name: "gh-auth", cmd: "gh-auth-login" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await setupCommand(t.ctx, { yes: true, profile: "ghost" });
    assert.equal(code, 1);
    assert.equal(readBinding(t.homeDir)?.profile, undefined);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
