import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { bindCommand } from "../../src/commands/bind.js";
import { readBinding } from "../../src/binding.js";

test("bind --show: warns when no binding", async () => {
  const t = makeContext();
  try {
    const code = await bindCommand(t.ctx, undefined, { show: true });
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("warn:")));
  } finally {
    t.cleanup();
  }
});

test("bind --show: prints binding when set", async () => {
  const df = makeDotfilesRepo({ version: 1 });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await bindCommand(t.ctx, undefined, { show: true });
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes(df.dir)));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind --unset: clears existing binding", async () => {
  const df = makeDotfilesRepo({ version: 1 });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await bindCommand(t.ctx, undefined, { unset: true });
    assert.equal(code, 0);
    assert.equal(existsSync(t.ctx.bindingPath), false);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind --unset: warns when no binding to clear", async () => {
  const t = makeContext();
  try {
    const code = await bindCommand(t.ctx, undefined, { unset: true });
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.startsWith("warn:")));
  } finally {
    t.cleanup();
  }
});

test("bind: missing target without --show/--unset returns 2", async () => {
  const t = makeContext();
  try {
    const code = await bindCommand(t.ctx, undefined, {});
    assert.equal(code, 2);
  } finally {
    t.cleanup();
  }
});

test("bind path: writes binding when path has marshal.json", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext();
  try {
    const code = await bindCommand(t.ctx, df.dir, {});
    assert.equal(code, 0);
    const b = readBinding(t.ctx.homeDir);
    assert.equal(b?.dotfilesRepo, df.dir);
    // Path-bind does NOT auto-sync.
    assert.equal(t.runner.calls.length, 0);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind path: refuses path without marshal.json", async () => {
  const t = makeContext();
  try {
    const code = await bindCommand(t.ctx, t.homeDir, {});
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("error:") && l.includes("marshal.json")));
  } finally {
    t.cleanup();
  }
});

test("bind URL: clones, writes binding, runs sync", async () => {
  // Use a fake URL — runner is mocked. We pre-create the target so the
  // clone "no-ops" (existsSync branch) AND a manifest is present so the
  // sync stage can succeed without network.
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ promptAnswers: [true] });
  try {
    const code = await bindCommand(
      t.ctx,
      "https://github.com/me/dotfiles.git",
      { path: df.dir, sync: true, yes: true },
    );
    assert.equal(code, 0);
    const b = readBinding(t.ctx.homeDir);
    assert.equal(b?.dotfilesRepo, df.dir);
    // Empty manifest → sync pulls dotfiles but finds nothing else to do.
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.log.captured.some((l) => l.includes("Bound to")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind URL with --no-sync: clones + binds without syncing", async () => {
  const df = makeDotfilesRepo({ version: 1 });
  const t = makeContext();
  try {
    const code = await bindCommand(
      t.ctx,
      "https://github.com/me/dotfiles.git",
      { path: df.dir, sync: false },
    );
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes("Skipping sync")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind URL: invokes git clone when target dir does not exist", async () => {
  const t = makeContext();
  // No pre-existing dir at the path → bind will call `git clone`. Mock the
  // runner so the clone "succeeds", then create marshal.json on disk so
  // writeBinding can validate.
  const cloneTarget = join(t.homeDir, "fakeclone");
  t.runner.respond(/^git clone/, {
    code: 0,
    stdout: "Cloning into 'fakeclone'...",
  });
  // Simulate clone side-effect: create the dir + manifest after exec.
  const origExec = t.runner.exec.bind(t.runner);
  t.runner.exec = async (command, opts) => {
    const result = await origExec(command, opts);
    if (command.startsWith("git clone")) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(cloneTarget, { recursive: true });
      writeFileSync(join(cloneTarget, "marshal.json"), JSON.stringify({ version: 1 }));
    }
    return result;
  };
  try {
    const code = await bindCommand(
      t.ctx,
      "https://github.com/me/dotfiles.git",
      { path: cloneTarget, sync: false },
    );
    assert.equal(code, 0);
    assert.equal(t.runner.calls.length, 1);
    assert.match(t.runner.calls[0].command, /^git clone https:\/\/github\.com\/me\/dotfiles\.git/);
    assert.ok(existsSync(join(cloneTarget, "marshal.json")));
  } finally {
    t.cleanup();
  }
});

// Sanity-check the binding file format is JSON (consumers may inspect it).
test("bind path: writes parseable JSON to ~/.marshal.json", async () => {
  const df = makeDotfilesRepo({ version: 1 });
  const t = makeContext();
  try {
    await bindCommand(t.ctx, df.dir, {});
    const raw = readFileSync(t.ctx.bindingPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.dotfilesRepo, df.dir);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
