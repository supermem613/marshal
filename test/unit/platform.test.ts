import { test } from "node:test";
import { strict as assert } from "node:assert";
import { appliesToPlatform, detectPlatform } from "../../src/platform.js";

test("appliesToPlatform: undefined platforms applies to all", () => {
  assert.equal(appliesToPlatform(undefined, "win32"), true);
  assert.equal(appliesToPlatform(undefined, "darwin"), true);
  assert.equal(appliesToPlatform(undefined, "linux"), true);
});

test("appliesToPlatform: empty array applies to all", () => {
  assert.equal(appliesToPlatform([], "win32"), true);
});

test("appliesToPlatform: matches included platform", () => {
  assert.equal(appliesToPlatform(["win32"], "win32"), true);
  assert.equal(appliesToPlatform(["win32", "darwin"], "darwin"), true);
});

test("appliesToPlatform: excludes missing platform", () => {
  assert.equal(appliesToPlatform(["win32"], "darwin"), false);
  assert.equal(appliesToPlatform(["darwin", "linux"], "win32"), false);
});

test("detectPlatform: returns the host platform", () => {
  const p = detectPlatform();
  assert.ok(["win32", "darwin", "linux"].includes(p));
});
