import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isAbsolute } from "node:path";
import { expandHome, resolvePath, DEFAULT_REPOS_PATH } from "../../src/paths.js";

test("expandHome: leaves non-tilde paths alone", () => {
  assert.equal(expandHome("/abs/path", "/home/u"), "/abs/path");
  assert.equal(expandHome("relative/path", "/home/u"), "relative/path");
  assert.equal(expandHome("C:/foo/bar", "/home/u"), "C:/foo/bar");
});

test("expandHome: expands bare ~", () => {
  assert.equal(expandHome("~", "/home/u"), "/home/u");
});

test("expandHome: expands ~/ prefix", () => {
  assert.equal(expandHome("~/repos", "/home/u").replace(/\\/g, "/"), "/home/u/repos");
});

test("expandHome: expands ~\\ prefix (Windows)", () => {
  assert.equal(expandHome("~\\repos", "/home/u").replace(/\\/g, "/"), "/home/u/repos");
});

test("resolvePath: returns absolute path", () => {
  const r = resolvePath("./foo", "/abs/base", "/home/u");
  assert.ok(isAbsolute(r));
});

test("resolvePath: respects ~ first", () => {
  const r = resolvePath("~/r", "/abs/base", "/home/u").replace(/\\/g, "/");
  assert.equal(r, "/home/u/r");
});

test("DEFAULT_REPOS_PATH is ~/repos", () => {
  assert.equal(DEFAULT_REPOS_PATH, "~/repos");
});
