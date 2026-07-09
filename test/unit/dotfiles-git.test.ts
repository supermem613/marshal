import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { dotfilesVcs } from "../../src/dotfiles-git.js";

// dotfilesVcs is marshal-scope backend selection for the bound dotfiles repo.
// Contract: explicit binding vcs override wins; otherwise the dotfiles
// marshal.json top-level vcs applies; otherwise the documented git default.

function writeBindingFile(homeDir: string, dotfilesRepo: string, vcs?: string): void {
  writeFileSync(
    join(homeDir, ".marshal.json"),
    JSON.stringify({ version: 1, dotfilesRepo, ...(vcs ? { vcs } : {}) }, null, 2),
    "utf8",
  );
}

test("dotfilesVcs: honors dotfiles manifest vcs when binding omits it", () => {
  const df = makeDotfilesRepo({ version: 1, vcs: "soda", repos: [] });
  const t = makeContext();
  try {
    writeBindingFile(t.homeDir, df.dir);
    assert.equal(dotfilesVcs(t.ctx), "soda");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("dotfilesVcs: explicit binding vcs overrides the manifest", () => {
  const df = makeDotfilesRepo({ version: 1, vcs: "soda", repos: [] });
  const t = makeContext();
  try {
    writeBindingFile(t.homeDir, df.dir, "git");
    assert.equal(dotfilesVcs(t.ctx), "git");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("dotfilesVcs: falls back to git default when the manifest declares no vcs", () => {
  const df = makeDotfilesRepo({ version: 1, repos: [] });
  const t = makeContext();
  try {
    writeBindingFile(t.homeDir, df.dir);
    assert.equal(dotfilesVcs(t.ctx), "git");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("dotfilesVcs: falls back to git default when the manifest cannot be read", () => {
  const df = makeDotfilesRepo({ version: 999 });
  const t = makeContext();
  try {
    writeBindingFile(t.homeDir, df.dir);
    assert.equal(dotfilesVcs(t.ctx), "git");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("dotfilesVcs: returns git default when marshal is unbound", () => {
  const t = makeContext();
  try {
    assert.equal(dotfilesVcs(t.ctx), "git");
  } finally {
    t.cleanup();
  }
});
