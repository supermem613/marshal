import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo, stubInstalledRepo } from "../helpers.js";
import { statusCommand } from "../../src/commands/status.js";
import { listCommand } from "../../src/commands/list.js";

test("status: errors with no binding", async () => {
  const t = makeContext();
  try {
    const code = await statusCommand(t.ctx, {});
    assert.equal(code, 1);
  } finally {
    t.cleanup();
  }
});

test("status: shows installed/missing across applies/skipped rows", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [
      { id: "App.Win", platforms: ["win32"] },
      { id: "App.Mac", platforms: ["darwin"] },
    ],
    repos: [
      { name: "tool-alpha", url: "u1", install_cmd: "i" },
      { name: "tool-beta", url: "u2", install_cmd: "i", platforms: ["win32"] },
      { name: "darwin-only", url: "u3", install_cmd: "i", platforms: ["darwin"] },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir });
  stubInstalledRepo(join(t.homeDir, "repos"), "tool-alpha");
  try {
    const code = await statusCommand(t.ctx, {});
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("installed") && text.includes("tool-alpha"));
    assert.ok(text.includes("missing") && text.includes("tool-beta"));
    assert.ok(text.includes("skipped") && text.includes("darwin-only"));
    assert.ok(text.includes("skipped") && text.includes("App.Mac"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("status --json: emits structured report", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await statusCommand(t.ctx, { json: true });
    assert.equal(code, 0);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!;
    const parsed = JSON.parse(raw.slice(5));
    assert.equal(parsed.bound, df.dir);
    assert.equal(parsed.repos[0].name, "tool-alpha");
    assert.equal(parsed.repos[0].installed, false);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("status: reports active profile and applies profile filter", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    repos: [
      { name: "shared", url: "u" },
      { name: "work-tool", url: "u", profiles: ["work"] },
      { name: "personal-tool", url: "u", profiles: ["personal"] },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await statusCommand(t.ctx, {});
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("Profile: work (binding)"));
    assert.ok(text.includes("missing") && text.includes("work-tool"));
    assert.ok(text.includes("skipped") && text.includes("personal-tool"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("list: prints apps and repos with platform/cwd/update info", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "Git.Git" }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: true }],
    repos: [{
      name: "tool-suite",
      url: "u",
      install_cmd: "x",
      install_cwd: "cli",
      update_cmd: "tool-suite update",
      platforms: ["win32"],
    }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await listCommand(t.ctx, {});
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("Git.Git"));
    assert.ok(text.includes("tool-suite"));
    assert.ok(text.includes("cwd: cli"));
    assert.ok(text.includes("install: x"));
    assert.ok(text.includes("update:  tool-suite update"));
    assert.ok(text.includes("platforms: win32"));
    assert.ok(text.includes("hooks (1)"));
    assert.ok(text.includes("config-sync"));
    assert.ok(text.includes("command: configsync sync"));
    assert.ok(!text.includes("install: x  update:"));
    assert.ok(text.includes("┌─ marshal manifest"));
    assert.ok(text.includes("Legend:"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("list: prints declared and item profiles", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [{ id: "Git.Git", profiles: ["work"] }],
    repos: [{ name: "tool-suite", url: "u", profiles: ["work"] }],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false, profiles: ["work"] }],
  });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await listCommand(t.ctx, {});
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("profile:  work (binding)"));
    assert.ok(text.includes("profiles (1)"));
    assert.ok(text.includes("work") && text.includes("1 apps, 1 repos, 1 hooks"));
    assert.ok(text.includes("Git.Git") && text.includes("scope: work"));
    assert.ok(text.includes("tool-suite") && text.includes("scope: work"));
    assert.ok(text.includes("config-sync") && text.includes("scope: work"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("list --json: emits raw manifest", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "X" }],
    repos: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await listCommand(t.ctx, { json: true });
    assert.equal(code, 0);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!;
    const parsed = JSON.parse(raw.slice(5));
    assert.equal(parsed.apps[0].id, "X");
    assert.deepEqual(parsed.hooks, []);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
