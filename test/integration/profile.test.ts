import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { profileCommand } from "../../src/commands/profile.js";

test("profile get: prints none when bound but unset", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "get");
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes("(none)")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile list: marks active profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await profileCommand(t.ctx, "list");
    assert.equal(code, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.equal(t.runner.calls[0].opts.cwd, df.dir);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("* work"));
    assert.ok(text.includes("  personal"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile set: validates and writes ~/.marshal.json", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "set", "personal");
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.dotfilesRepo, df.dir);
    assert.equal(parsed.profile, "personal");
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile set: stops before writing when dotfiles pull fails", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  t.runner.respond("git pull", { fail: true, code: 1, stderr: "diverged\n" });
  try {
    const code = await profileCommand(t.ctx, "set", "personal");
    assert.equal(code, 1);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.profile, "work");
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.ok(t.log.captured.some((l) => l.includes("dotfiles pull failed")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile set: rejects unknown profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "set", "personal");
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.includes("Unknown profile")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile clear: removes profile but preserves binding", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await profileCommand(t.ctx, "clear");
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.dotfilesRepo, df.dir);
    assert.equal(parsed.profile, undefined);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile clear: stops before writing when dotfiles pull fails", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  t.runner.respond("git pull", { fail: true, code: 1, stderr: "diverged\n" });
  try {
    const code = await profileCommand(t.ctx, "clear");
    assert.equal(code, 1);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.profile, "work");
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.ok(t.log.captured.some((l) => l.includes("dotfiles pull failed")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile add: declares a new manifest profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"], apps: [], repos: [], hooks: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "add", "personal", undefined, undefined, { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.profiles, ["work", "personal"]);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.runner.calls[1].command.startsWith("git add"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile add: rejects invalid profile names", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: [], apps: [], repos: [], hooks: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "add", "bad profile", undefined, undefined, { yes: true });
    assert.equal(code, 1);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.profiles, []);
    assert.ok(t.log.captured.some((l) => l.includes("profile must be alphanumeric")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile remove: refuses when manifest items still reference the profile", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    apps: [{ id: "Git.Git", profiles: ["personal"] }],
    repos: [],
    hooks: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "remove", "personal", undefined, undefined, { yes: true });
    assert.equal(code, 1);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.profiles, ["work", "personal"]);
    assert.ok(t.log.captured.some((l) => l.includes("app:Git.Git")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile remove: deletes unused manifest profile and clears matching local active profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"], apps: [], repos: [], hooks: [] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "personal" });
  try {
    const code = await profileCommand(t.ctx, "remove", "personal", undefined, undefined, { yes: true });
    assert.equal(code, 0);
    const manifest = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(manifest.profiles, ["work"]);
    const binding = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(binding.profile, undefined);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile scope: adds an existing app to a profile scope", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [{ id: "Git.Git" }],
    repos: [],
    hooks: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "scope", "app", "Git.Git", "work", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.apps[0].profiles, ["work"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile scope: adds an existing hook to a profile scope", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [],
    repos: [],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "scope", "hook", "config-sync", "work", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.hooks[0].profiles, ["work"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile scope: adds multiple existing repos to a profile scope", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [],
    repos: [{ name: "forge", url: "u1" }, { name: "marshal", url: "u2" }],
    hooks: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "scope", "repo", ["forge", "marshal"], "work", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.repos.map((r: { profiles: string[] }) => r.profiles), [["work"], ["work"]]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile scope: adds multiple existing apps to a profile scope", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [{ id: "Git.Git" }, { id: "OpenJS.NodeJS.LTS" }],
    repos: [],
    hooks: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "scope", "app", ["Git.Git", "OpenJS.NodeJS.LTS"], "work", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.apps.map((a: { profiles: string[] }) => a.profiles), [["work"], ["work"]]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile unscope: removes a profile from an existing hook scope", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    apps: [],
    repos: [],
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false, profiles: ["work", "personal"] }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "unscope", "hook", "config-sync", "personal", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.hooks[0].profiles, ["work"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile unscope: removes a profile from multiple existing hook scopes", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work", "personal"],
    apps: [],
    repos: [],
    hooks: [
      { name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false, profiles: ["work", "personal"] },
      { name: "prompt-sync", stage: "post-repos", cmd: "prompt sync", interactive: false, profiles: ["work", "personal"] },
    ],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "unscope", "hook", ["config-sync", "prompt-sync"], "personal", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(parsed.hooks.map((h: { profiles: string[] }) => h.profiles), [["work"], ["work"]]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile unscope: removes the profiles field when the last scope is removed", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    profiles: ["work"],
    apps: [{ id: "Git.Git", profiles: ["work"] }],
    repos: [],
    hooks: [],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "unscope", "app", "Git.Git", "work", { yes: true });
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(parsed.apps[0].profiles, undefined);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
