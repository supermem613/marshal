import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { bindCommand } from "../../src/commands/bind.js";
import { readBinding } from "../../src/binding.js";
import { makeContext, makeDotfilesRepo } from "../helpers.js";

test("bind <path> --vcs soda records the vcs in the binding", async () => {
  const t = makeContext();
  const df = makeDotfilesRepo({ version: 1 });
  try {
    const code = await bindCommand(t.ctx, df.dir, { vcs: "soda" });
    assert.equal(code, 0);
    const b = readBinding(t.homeDir);
    assert.equal(b?.dotfilesRepo, df.dir);
    assert.equal(b?.vcs, "soda");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind <path> --vcs git records git in the binding", async () => {
  const t = makeContext();
  const df = makeDotfilesRepo({ version: 1 });
  try {
    const code = await bindCommand(t.ctx, df.dir, { vcs: "git" });
    assert.equal(code, 0);
    assert.equal(readBinding(t.homeDir)?.vcs, "git");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind --vcs rejects an unknown vcs value", async () => {
  const t = makeContext();
  const df = makeDotfilesRepo({ version: 1 });
  try {
    const code = await bindCommand(t.ctx, df.dir, { vcs: "hg" });
    assert.notEqual(code, 0);
    assert.equal(readBinding(t.homeDir), null);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("bind <url> --vcs soda clones through the soda backend", async () => {
  const t = makeContext();
  t.runner.respond(/^sd clone/, { code: 0 });
  const targetPath = join(t.homeDir, "repos", "dotfiles");
  try {
    // The mock runner does not materialize a cloned repo, so the subsequent
    // binding write is exercised by the bind <path> tests above. Here we assert
    // the initial clone is routed through the declared soda backend, not git.
    await bindCommand(t.ctx, "https://example.com/me/dotfiles.git", {
      vcs: "soda",
      path: targetPath,
      sync: false,
    });
    const cloneCmds = t.runner.calls.map((c) => c.command).filter((c) => c.includes("clone"));
    assert.deepEqual(cloneCmds, [`sd clone https://example.com/me/dotfiles.git "${targetPath}"`]);
  } finally {
    t.cleanup();
  }
});
