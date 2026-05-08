import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ManifestSchema, validateManifest, ManifestError, readManifest } from "../../src/manifest.js";
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
    apps: [{ id: "Git.Git" }, { id: "Microsoft.DotNet.SDK.9", platforms: ["win32"] }],
    repos: [{
      name: "tool-alpha",
      url: "https://github.com/me/tool-alpha.git",
      install_cmd: "npm install && npm run build && npm link",
      update_cmd: "tool-alpha update",
      platforms: ["win32", "darwin"],
    }],
    hooks: [{
      name: "config-sync",
      stage: "post-repos",
      cmd: "configsync sync",
      interactive: true,
    }],
  });
  assert.ok(r.success, JSON.stringify(r));
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
