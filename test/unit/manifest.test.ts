import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ManifestSchema, validateManifest, ManifestError, readManifest, cliField } from "../../src/manifest.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ManifestSchema: accepts minimal manifest", () => {
  const r = ManifestSchema.safeParse({ version: 1 });
  assert.ok(r.success, JSON.stringify(r));
  if (r.success) {
    assert.deepEqual(r.data.apps, []);
    assert.deepEqual(r.data.repos, []);
    assert.deepEqual(r.data.hooks, []);
  }
});

test("ManifestSchema: accepts full manifest", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    reposPath: "~/repos",
    profiles: ["work", "personal"],
    apps: [{ id: "Git.Git" }, { id: "Microsoft.DotNet.SDK.9", platforms: ["win32"], profiles: ["work"] }],
    repos: [{
      name: "tool-alpha",
      url: "https://github.com/me/tool-alpha.git",
      install_cmd: "npm install && npm run build && npm link",
      update_cmd: "tool-alpha update",
      platforms: ["win32", "darwin"],
      profiles: ["work", "personal"],
    }],
    hooks: [{
      name: "config-sync",
      stage: "post-repos",
      cmd: "configsync sync",
      interactive: true,
      profiles: ["personal"],
    }],
  });
  assert.ok(r.success, JSON.stringify(r));
});

test("ManifestSchema: accepts npm packages and rejects duplicates", () => {
  const ok = ManifestSchema.safeParse({
    version: 1,
    npm: [{ name: "typescript" }, { name: "typescript-language-server", platforms: ["win32"] }],
  });
  assert.ok(ok.success, JSON.stringify(ok));
  const dup = ManifestSchema.safeParse({
    version: 1,
    npm: [{ name: "typescript" }, { name: "typescript" }],
  });
  assert.equal(dup.success, false);
});

test("ManifestSchema: defaults npm to empty for legacy manifests", () => {
  const r = ManifestSchema.safeParse({ version: 1 });
  assert.ok(r.success);
  if (r.success) {
    assert.deepEqual(r.data.npm, []);
  }
});

test("ManifestSchema: accepts setup steps and defaults interactive to true", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    profiles: ["work"],
    setup: [
      { name: "gh-auth", cmd: "gh auth login", check_cmd: "gh auth status" },
      { name: "az-login", cmd: "az login", profiles: ["work"], interactive: false },
    ],
  });
  assert.ok(r.success, JSON.stringify(r));
  if (r.success) {
    assert.equal(r.data.setup[0].interactive, true);
    assert.equal(r.data.setup[0].check_cmd, "gh auth status");
    assert.equal(r.data.setup[1].interactive, false);
  }
});

test("ManifestSchema: rejects duplicate setup step names", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    setup: [{ name: "gh-auth", cmd: "a" }, { name: "gh-auth", cmd: "b" }],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: rejects setup scoped to unknown profile", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    setup: [{ name: "gh-auth", cmd: "gh auth login", profiles: ["ghost"] }],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: defaults setup to empty for legacy manifests", () => {
  const r = ManifestSchema.safeParse({ version: 1 });
  assert.ok(r.success);
  if (r.success) {
    assert.deepEqual(r.data.setup, []);
  }
});

test("cliField: exposes setup interactive negative flag", () => {
  assert.deepEqual(cliField("setup", "interactive"), {
    cliFlag: "--no-interactive",
    cliDescription: "Run the setup command without a real terminal attached",
  });
});

test("cliField: exposes CLI help metadata from manifest schema code", () => {
  assert.deepEqual(cliField("repo", "install_cmd"), {
    cliFlag: "--install-cmd <cmd>",
    cliDescription: "Install command to run after clone or pull",
  });
  assert.deepEqual(cliField("hook", "cmd"), {
    cliFlag: "--cmd <cmd>",
    cliDescription: "Shell command to run during sync",
  });
});

test("ManifestSchema: rejects wrong version", () => {
  const r = ManifestSchema.safeParse({ version: 2 });
  assert.equal(r.success, false);
});

test("ManifestSchema: accepts repo without install_cmd", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [{ name: "x", url: "https://x" }],
  });
  assert.equal(r.success, true);
});

test("ManifestSchema: rejects bad repo.name characters", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [{ name: "bad name with spaces", url: "https://x", install_cmd: "x" }],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: detects duplicate repo names via superRefine", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [
      { name: "tool-alpha", url: "u1", install_cmd: "x" },
      { name: "tool-alpha", url: "u2", install_cmd: "y" },
    ],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: rejects unknown platform values", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [{ name: "x", url: "u", install_cmd: "c", platforms: ["bsd"] }],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: update_cmd nullable", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [{ name: "x", url: "u", install_cmd: "c", update_cmd: null }],
  });
  assert.ok(r.success);
});

test("ManifestSchema: rejects duplicate hook names", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    hooks: [
      { name: "config-sync", stage: "post-repos", cmd: "configsync sync" },
      { name: "config-sync", stage: "post-repos", cmd: "configsync sync" },
    ],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: rejects duplicate profiles", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    profiles: ["work", "work"],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: rejects item profile not declared at top level", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    profiles: ["work"],
    repos: [{ name: "tool-alpha", url: "u", profiles: ["personal"] }],
  });
  assert.equal(r.success, false);
});

test("ManifestSchema: defaults profiles to empty for legacy manifests", () => {
  const r = ManifestSchema.safeParse({ version: 1 });
  assert.ok(r.success);
  if (r.success) {
    assert.deepEqual(r.data.profiles, []);
  }
});

test("ManifestSchema: rejects absolute hook cwd", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    hooks: [{ name: "config-sync", stage: "post-repos", cmd: "configsync sync", cwd: "C:\\dotfiles" }],
  });
  assert.equal(r.success, false);
});

test("validateManifest: throws ManifestError on bad input", () => {
  assert.throws(() => validateManifest({ version: 99 }), ManifestError);
});

test("readManifest: throws on missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "marshal-empty-"));
  try {
    assert.throws(() => readManifest(dir), ManifestError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: throws on invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "marshal-bad-"));
  try {
    writeFileSync(join(dir, "marshal.json"), "not json{");
    assert.throws(() => readManifest(dir), /Invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: returns parsed manifest with defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "marshal-good-"));
  try {
    writeFileSync(join(dir, "marshal.json"), JSON.stringify({ version: 1 }));
    const m = readManifest(dir);
    assert.equal(m.version, 1);
    assert.deepEqual(m.apps, []);
    assert.deepEqual(m.repos, []);
    assert.deepEqual(m.hooks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ManifestSchema: accepts per-repo and marshal-level vcs", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    vcs: "soda",
    repos: [{ name: "tool-a", url: "https://x/a.git", vcs: "git" }],
  });
  assert.ok(r.success, JSON.stringify(r));
  if (r.success) {
    assert.equal(r.data.vcs, "soda");
    assert.equal(r.data.repos[0].vcs, "git");
  }
});

test("ManifestSchema: vcs is optional and left undefined when absent", () => {
  const r = ManifestSchema.safeParse({
    version: 1,
    repos: [{ name: "tool-a", url: "https://x/a.git" }],
  });
  assert.ok(r.success, JSON.stringify(r));
  if (r.success) {
    assert.equal(r.data.vcs, undefined);
    assert.equal(r.data.repos[0].vcs, undefined);
  }
});

test("ManifestSchema: rejects an unknown vcs value", () => {
  const r = ManifestSchema.safeParse({ version: 1, vcs: "hg" });
  assert.equal(r.success, false);
});
