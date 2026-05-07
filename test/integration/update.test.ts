import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext } from "../helpers.js";
import { updateCommand } from "../../src/commands/update.js";

function withSrcDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "marshal-update-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("update: errors when source dir does not exist", async () => {
  const t = makeContext({ marshalSourceDir: "C:/no/such/path/marshal" });
  try {
    const code = await updateCommand(t.ctx);
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("error:") && l.includes("not found")));
  } finally {
    t.cleanup();
  }
});

test("update: runs git pull → npm install → npm run build in source dir", async () => {
  withSrcDir(async (srcDir) => {
    mkdirSync(join(srcDir, ".git"), { recursive: true });
    writeFileSync(join(srcDir, "package.json"), "{}");
    const t = makeContext({ marshalSourceDir: srcDir });
    t.runner.respond("git pull", { code: 0 });
    t.runner.respond("npm install", { code: 0 });
    t.runner.respond("npm run build", { code: 0 });
    try {
      const code = await updateCommand(t.ctx);
      assert.equal(code, 0);
      assert.deepEqual(
        t.runner.calls.map((c) => c.command),
        ["git pull --ff-only", "npm install", "npm run build"],
      );
      // Every step ran with cwd = source dir.
      for (const c of t.runner.calls) {
        assert.equal(c.opts.cwd, srcDir);
      }
    } finally {
      t.cleanup();
    }
  });
});

test("update: skips npm install and npm run build when git pull is already up to date", async () => {
  withSrcDir(async (srcDir) => {
    mkdirSync(join(srcDir, ".git"), { recursive: true });
    writeFileSync(join(srcDir, "package.json"), "{}");
    const t = makeContext({ marshalSourceDir: srcDir });
    t.runner.respond("git pull", { code: 0, stdout: "Already up to date.\n" });
    try {
      const code = await updateCommand(t.ctx);
      assert.equal(code, 0);
      assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    } finally {
      t.cleanup();
    }
  });
});

test("update: aborts on first failure with non-zero exit", async () => {
  withSrcDir(async (srcDir) => {
    const t = makeContext({ marshalSourceDir: srcDir });
    t.runner.respond("git pull", { fail: true, code: 1 });
    try {
      const code = await updateCommand(t.ctx);
      assert.equal(code, 1);
      // Only the failed step ran — install/build skipped.
      assert.equal(t.runner.calls.length, 1);
      assert.match(t.runner.calls[0].command, /^git pull/);
    } finally {
      t.cleanup();
    }
  });
});
