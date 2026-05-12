import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo, stubInstalledRepo } from "../helpers.js";
import { addAppCommand, addCommand, addHookCommand, removeCommand } from "../../src/commands/add.js";

test("add: appends repo to manifest without syncing by default", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"], apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir, promptAnswers: [true] });
  try {
    const code = await addCommand(
      t.ctx,
      "https://github.com/me/newtool.git",
      undefined,
      { yes: true, profiles: ["work"] },
    );
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 1);
    assert.equal(m.repos[0].name, "newtool");
    assert.equal(m.repos[0].url, "https://github.com/me/newtool.git");
    assert.deepEqual(m.repos[0].profiles, ["work"]);
    assert.equal(t.runner.calls.length, 4);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[0].opts.cwd, df.dir);
    assert.ok(t.runner.calls[1].command.startsWith("git add"));
    assert.ok(t.runner.calls[2].command.startsWith("git commit"));
    assert.ok(t.runner.calls[3].command.startsWith("git push"));
    assert.ok(t.log.captured.some((l) => l.includes("marshal sync")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add: rejects duplicate repo name", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await addCommand(
      t.ctx,
      "https://x/tool-alpha.git",
      "tool-alpha",
      { yes: true },
    );
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("error:") && l.includes("already")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add: stops before writing when dotfiles pull fails", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git pull", { fail: true, code: 1, stderr: "diverged\n" });
  try {
    const code = await addCommand(t.ctx, "https://x/foo.git", "foo", { yes: true });
    assert.equal(code, 1);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 0);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
    assert.ok(t.log.captured.some((l) => l.includes("dotfiles pull failed")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add --sync: writes manifest and syncs just the new repo", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git clone", { code: 0 });
  t.runner.respond("make", { code: 0 });
  try {
    const code = await addCommand(
      t.ctx,
      "https://x/foo.git",
      "foo",
      {
        yes: true,
        sync: true,
        install_cmd: "make",
        update_cmd: "make update",
        install_cwd: "subdir",
        platforms: ["win32"],
      },
    );
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos[0].install_cmd, "make");
    assert.equal(m.repos[0].update_cmd, "make update");
    assert.equal(m.repos[0].install_cwd, "subdir");
    assert.deepEqual(m.repos[0].platforms, ["win32"]);
    assert.ok(t.runner.calls.some((c) => c.command.startsWith("git clone")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add: confirmation declined aborts cleanly", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir, promptAnswers: [false] });
  try {
    const code = await addCommand(t.ctx, "https://x/foo.git", "foo", {});
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 0);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add-app: appends app to manifest without syncing by default", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"], apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await addAppCommand(t.ctx, "Git.Git", { yes: true, platforms: ["win32"], profiles: ["work"] });
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(m.apps, [{ id: "Git.Git", platforms: ["win32"], profiles: ["work"] }]);
    assert.equal(t.runner.calls.length, 4);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.runner.calls[1].command.startsWith("git add"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add-app: rejects duplicate app id", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [{ id: "Git.Git" }], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await addAppCommand(t.ctx, "Git.Git", { yes: true });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add-hook: appends hook to manifest without syncing by default", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"], apps: [], repos: [], hooks: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await addHookCommand(t.ctx, "config-sync", {
      yes: true,
      cmd: "configsync sync",
      interactive: true,
      platforms: ["win32"],
      profiles: ["work"],
    });
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.deepEqual(m.hooks, [{
      name: "config-sync",
      stage: "post-repos",
      cmd: "configsync sync",
      interactive: true,
      platforms: ["win32"],
      profiles: ["work"],
    }]);
    assert.equal(t.runner.calls.length, 4);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.ok(t.runner.calls[1].command.startsWith("git add"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("add-hook: rejects invalid cwd", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [], hooks: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await addHookCommand(t.ctx, "config-sync", {
      yes: true,
      cmd: "configsync sync",
      cwd: "..\\outside",
    });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("remove: rejects unknown name", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await removeCommand(t.ctx, "ghost", { yes: true });
    assert.equal(code, 1);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("remove: deletes manifest entry and cloned dir by default", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  const cloned = stubInstalledRepo(join(t.homeDir, "repos"), "tool-alpha");
  try {
    const code = await removeCommand(t.ctx, "tool-alpha", { yes: true });
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 0);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[0].opts.cwd, df.dir);
    assert.equal(existsSync(cloned), false);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("remove: stops before writing or deleting when dotfiles pull fails", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  const cloned = stubInstalledRepo(join(t.homeDir, "repos"), "tool-alpha");
  t.runner.respond("git pull", { fail: true, code: 1, stderr: "diverged\n" });
  try {
    const code = await removeCommand(t.ctx, "tool-alpha", { yes: true });
    assert.equal(code, 1);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 1);
    assert.equal(existsSync(cloned), true);
    assert.deepEqual(t.runner.calls.map((c) => c.command), ["git pull --ff-only"]);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("remove --keep-files: deletes manifest entry but leaves cloned dir", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  const cloned = stubInstalledRepo(join(t.homeDir, "repos"), "tool-alpha");
  try {
    const code = await removeCommand(t.ctx, "tool-alpha", { yes: true, deleteFiles: false });
    assert.equal(code, 0);
    assert.equal(existsSync(cloned), true);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("remove: confirmation declined leaves manifest intact", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir, promptAnswers: [false] });
  try {
    const code = await removeCommand(t.ctx, "tool-alpha", {});
    assert.equal(code, 0);
    const m = JSON.parse(readFileSync(join(df.dir, "marshal.json"), "utf8"));
    assert.equal(m.repos.length, 1);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
