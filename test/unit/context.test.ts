import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveMarshalSourceDir } from "../../src/context.js";

test("resolveMarshalSourceDir: walks up to package.json", () => {
  // Build a fake src/ + dist/ tree with a package.json at the root.
  const root = mkdtempSync(join(tmpdir(), "marshal-srcdir-"));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "marshal" }));
    writeFileSync(join(root, "dist", "context.js"), "// fake");
    // Resolve from a file:// URL pointing at dist/context.js.
    const fakeImportMetaUrl = "file:///" + join(root, "dist", "context.js").replace(/\\/g, "/");
    const resolved = resolveMarshalSourceDir(fakeImportMetaUrl);
    assert.equal(resolved, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveMarshalSourceDir: tolerates being called from src/ (tsx test mode)", () => {
  // The file walks up looking for package.json — when imported from src/ via
  // tsx, that's one level up, not two. Validate by pointing at a fake src tree.
  const root = mkdtempSync(join(tmpdir(), "marshal-srcdir2-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "marshal" }));
    writeFileSync(join(root, "src", "context.ts"), "// fake");
    const fakeImportMetaUrl = "file:///" + join(root, "src", "context.ts").replace(/\\/g, "/");
    const resolved = resolveMarshalSourceDir(fakeImportMetaUrl);
    assert.ok(existsSync(join(resolved, "package.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveMarshalSourceDir: real run resolves to a dir containing package.json", () => {
  // Use the test file's own URL — walking up should find marshal's package.json.
  const fakeImportMetaUrl = "file:///" + fileURLToPath(import.meta.url).replace(/\\/g, "/");
  const resolved = resolveMarshalSourceDir(fakeImportMetaUrl);
  assert.ok(existsSync(join(resolved, "package.json")));
});

void dirname;
