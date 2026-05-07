import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isUrl } from "../../src/url.js";

test("isUrl: https URL", () => {
  assert.equal(isUrl("https://github.com/me/repo.git"), true);
  assert.equal(isUrl("https://example.com/repo"), true);
});

test("isUrl: http URL", () => {
  assert.equal(isUrl("http://example.com/r.git"), true);
});

test("isUrl: ssh URL", () => {
  assert.equal(isUrl("ssh://git@github.com/me/repo.git"), true);
});

test("isUrl: git protocol", () => {
  assert.equal(isUrl("git://github.com/me/repo.git"), true);
});

test("isUrl: file URL", () => {
  assert.equal(isUrl("file:///tmp/repo"), true);
});

test("isUrl: git@ shorthand", () => {
  assert.equal(isUrl("git@github.com:me/repo.git"), true);
});

test("isUrl: Windows drive paths are NOT URLs", () => {
  assert.equal(isUrl("C:\\Users\\m\\repo"), false);
  assert.equal(isUrl("D:/repos/dotfiles"), false);
});

test("isUrl: tilde paths are NOT URLs", () => {
  assert.equal(isUrl("~/repos/dotfiles"), false);
});

test("isUrl: relative paths are NOT URLs", () => {
  assert.equal(isUrl("./repo"), false);
  assert.equal(isUrl("repo"), false);
  assert.equal(isUrl("../up/one"), false);
});

test("isUrl: bare .git suffix without scheme is NOT a URL (could be local bare repo path)", () => {
  assert.equal(isUrl("/home/me/repo.git"), false);
  assert.equal(isUrl("repo.git"), false);
});
