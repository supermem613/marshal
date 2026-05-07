import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isAbsolute } from "node:path";
import { resolvePath, expandHome } from "../../src/paths.js";

test("resolvePath: absolute paths returned unchanged", () => {
  // Use a platform-correct absolute path.
  const abs = process.platform === "win32" ? "C:\\foo\\bar" : "/foo/bar";
  assert.equal(resolvePath(abs, "/cwd/base", "/home/u"), abs);
});

test("resolvePath: relative paths resolved against base", () => {
  const r = resolvePath("./sub/dir", "/abs/cwd", "/home/u").replace(/\\/g, "/");
  // resolve normalizes and joins; on Windows the drive prefix changes things —
  // accept either platform's result.
  assert.ok(r.endsWith("sub/dir"));
});

test("expandHome: ~/foo/bar joins correctly with multi-segment", () => {
  const r = expandHome("~/foo/bar/baz", "/home/u").replace(/\\/g, "/");
  assert.equal(r, "/home/u/foo/bar/baz");
});

test("resolvePath: bare ~ resolves to home", () => {
  const r = resolvePath("~", "/cwd", "/home/u");
  assert.ok(isAbsolute(r));
  assert.equal(r.replace(/\\/g, "/"), "/home/u");
});

test("resolvePath: empty-string base falls back to cwd", () => {
  // resolve("") returns process.cwd() — verify resolvePath stays absolute even
  // when the supplied base is unhelpful.
  const r = resolvePath("foo", "", "/home/u");
  assert.ok(isAbsolute(r));
});
