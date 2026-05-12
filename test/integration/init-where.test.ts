import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext } from "../helpers.js";
import { initCommand } from "../../src/commands/init.js";
import { whereCommand } from "../../src/commands/where.js";
import { readBinding } from "../../src/binding.js";

test("init: creates marshal.json and binds", async () => {
  const t = makeContext();
  try {
    const code = await initCommand(t.ctx);
    assert.equal(code, 0);
    const path = join(t.ctx.cwd, "marshal.json");
    assert.ok(existsSync(path));
    const m = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(m.version, 1);
    assert.deepEqual(m.apps, []);
    assert.deepEqual(m.repos, []);
    const b = readBinding(t.ctx.homeDir);
    assert.equal(b?.dotfilesRepo, t.ctx.cwd);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.equal(t.runner.calls[0].opts.cwd, t.ctx.cwd);
  } finally {
    t.cleanup();
  }
});

test("init: stops before writing when dotfiles pull fails", async () => {
  const t = makeContext();
  t.runner.respond("git pull", { fail: true, code: 1, stderr: "diverged\n" });
  try {
    const code = await initCommand(t.ctx);
    assert.equal(code, 1);
    assert.equal(existsSync(join(t.ctx.cwd, "marshal.json")), false);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.ok(t.log.captured.some((l) => l.includes("dotfiles pull failed")));
  } finally {
    t.cleanup();
  }
});

test("init: refuses when marshal.json exists", async () => {
  const t = makeContext();
  try {
    await initCommand(t.ctx);
    const code = await initCommand(t.ctx);
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("error:") && l.includes("already exists")));
  } finally {
    t.cleanup();
  }
});

test("init --no-bind: writes manifest without binding", async () => {
  const t = makeContext();
  try {
    const code = await initCommand(t.ctx, { bind: false });
    assert.equal(code, 0);
    assert.equal(readBinding(t.ctx.homeDir), null);
  } finally {
    t.cleanup();
  }
});

test("where: prints bound dotfiles path", async () => {
  const t = makeContext();
  try {
    await initCommand(t.ctx);
    t.log.captured.length = 0;
    t.runner.reset();
    const code = await whereCommand(t.ctx);
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes(t.ctx.cwd)));
  } finally {
    t.cleanup();
  }
});

test("where: errors when no binding", async () => {
  const t = makeContext();
  try {
    const code = await whereCommand(t.ctx);
    assert.equal(code, 1);
  } finally {
    t.cleanup();
  }
});
