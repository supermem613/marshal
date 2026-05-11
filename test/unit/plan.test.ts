import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlan, resolveReposPath, unknownRepoNames } from "../../src/plan.js";
import { Manifest } from "../../src/manifest.js";

function makeManifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    profiles: [],
    apps: [],
    repos: [],
    hooks: [],
    ...over,
  };
}

test("resolveReposPath: defaults to ~/repos", () => {
  const r = resolveReposPath(makeManifest(), "/home/u").replace(/\\/g, "/");
  assert.equal(r, "/home/u/repos");
});

test("resolveReposPath: respects manifest override", () => {
  const r = resolveReposPath(makeManifest({ reposPath: "~/code" }), "/home/u").replace(/\\/g, "/");
  assert.equal(r, "/home/u/code");
});

test("buildPlan: empty manifest yields empty plan", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const p = buildPlan(makeManifest(), { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.apps.length, 0);
    assert.equal(p.repos.length, 0);
    assert.equal(p.hooks.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: filters apps and repos by platform", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      apps: [
        { id: "WinOnly", platforms: ["win32"] },
        { id: "MacOnly", platforms: ["darwin"] },
        { id: "All" },
      ],
      repos: [
        { name: "tool-win", url: "u1", install_cmd: "x", platforms: ["win32"] },
        { name: "tool-alpha", url: "u2", install_cmd: "y" },
        { name: "tool-mac", url: "u3", install_cmd: "z", platforms: ["darwin"] },
      ],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.deepEqual(p.apps.map((a) => a.id), ["WinOnly", "All"]);
    assert.deepEqual(p.repos.map((r) => r.name), ["tool-win", "tool-alpha"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: legacy manifest with no profiles still includes everything platform-applicable", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      apps: [{ id: "All" }],
      repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
      hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.deepEqual(p.apps.map((a) => a.id), ["All"]);
    assert.deepEqual(p.repos.map((r) => r.name), ["tool-alpha"]);
    assert.deepEqual(p.hooks.map((h) => h.name), ["config-sync"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: filters apps repos and hooks by active profile", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      profiles: ["work", "personal"],
      apps: [
        { id: "Shared" },
        { id: "Work", profiles: ["work"] },
        { id: "Personal", profiles: ["personal"] },
      ],
      repos: [
        { name: "shared", url: "u", install_cmd: "i" },
        { name: "work", url: "u", install_cmd: "i", profiles: ["work"] },
        { name: "personal", url: "u", install_cmd: "i", profiles: ["personal"] },
      ],
      hooks: [
        { name: "shared-hook", stage: "post-repos", cmd: "x", interactive: false },
        { name: "work-hook", stage: "post-repos", cmd: "x", interactive: false, profiles: ["work"] },
      ],
    });
    const p = buildPlan(m, {
      homeDir: home,
      dotfilesRepo: home,
      platform: "win32",
      activeProfile: { profile: "work", source: "binding" },
    });
    assert.deepEqual(p.apps.map((a) => a.id), ["Shared", "Work"]);
    assert.deepEqual(p.repos.map((r) => r.name), ["shared", "work"]);
    assert.deepEqual(p.hooks.map((h) => h.name), ["shared-hook", "work-hook"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: excludes profile-scoped items when no active profile", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      profiles: ["work"],
      apps: [{ id: "Shared" }, { id: "Work", profiles: ["work"] }],
      repos: [{ name: "shared", url: "u" }, { name: "work", url: "u", profiles: ["work"] }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.deepEqual(p.apps.map((a) => a.id), ["Shared"]);
    assert.deepEqual(p.repos.map((r) => r.name), ["shared"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: marks missing repo as clone-and-install", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "clone-and-install");
    assert.equal(p.repos[0].exists, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: marks existing repo with update_cmd as update", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    mkdirSync(join(home, "repos", "tool-alpha"), { recursive: true });
    const m = makeManifest({
      repos: [{ name: "tool-alpha", url: "u", install_cmd: "i", update_cmd: "tool-alpha update" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "update");
    assert.equal(p.repos[0].exists, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: marks existing repo without update_cmd as pull-and-install", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    mkdirSync(join(home, "repos", "tool-beta"), { recursive: true });
    const m = makeManifest({
      repos: [{ name: "tool-beta", url: "u", install_cmd: "i" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "pull-and-install");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: install_cwd is appended to targetDir", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      repos: [{ name: "tool-suite", url: "u", install_cmd: "i", install_cwd: "cli" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.ok(p.repos[0].installCwd.endsWith(join("tool-suite", "cli")) || p.repos[0].installCwd.endsWith("tool-suite/cli"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: repoFilter limits results", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      repos: [
        { name: "a", url: "u", install_cmd: "i" },
        { name: "b", url: "u", install_cmd: "i" },
      ],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32", repoFilter: ["b"] });
    assert.deepEqual(p.repos.map((r) => r.name), ["b"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: includes post-repo hooks by default", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  const dotfiles = join(home, "dotfiles");
  try {
    const m = makeManifest({
      hooks: [{
        name: "config-sync",
        stage: "post-repos",
        cmd: "configsync sync",
        cwd: ".",
        interactive: true,
      }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: dotfiles, platform: "win32" });
    assert.equal(p.hooks.length, 1);
    assert.equal(p.hooks[0].command, "configsync sync");
    assert.equal(p.hooks[0].cwd, dotfiles);
    assert.equal(p.hooks[0].interactive, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: can skip hooks explicitly", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", interactive: false }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32", includeHooks: false });
    assert.equal(p.hooks.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("unknownRepoNames: returns names not in manifest", () => {
  const m = makeManifest({
    repos: [{ name: "a", url: "u", install_cmd: "i" }],
  });
  assert.deepEqual(unknownRepoNames(m, "win32", ["a", "b"]), ["b"]);
});

test("unknownRepoNames: ignores names skipped by platform filter", () => {
  const m = makeManifest({
    repos: [{ name: "tool-win", url: "u", install_cmd: "i", platforms: ["win32"] }],
  });
  assert.deepEqual(unknownRepoNames(m, "darwin", ["tool-win"]), ["tool-win"]);
});

test("buildPlan: missing repo without install_cmd → clone action", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    const m = makeManifest({
      repos: [{ name: "scripts", url: "u" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "clone");
    assert.equal(p.repos[0].installCmd, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: existing repo without install_cmd or update_cmd → pull action", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    mkdirSync(join(home, "repos", "scripts"), { recursive: true });
    const m = makeManifest({
      repos: [{ name: "scripts", url: "u" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "pull");
    assert.equal(p.repos[0].installCmd, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildPlan: existing repo with update_cmd but no install_cmd → update action", () => {
  const home = mkdtempSync(join(tmpdir(), "marshal-plan-"));
  try {
    mkdirSync(join(home, "repos", "scripts"), { recursive: true });
    const m = makeManifest({
      repos: [{ name: "scripts", url: "u", update_cmd: "scripts update" }],
    });
    const p = buildPlan(m, { homeDir: home, dotfilesRepo: home, platform: "win32" });
    assert.equal(p.repos[0].action, "update");
    assert.equal(p.repos[0].installCmd, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
