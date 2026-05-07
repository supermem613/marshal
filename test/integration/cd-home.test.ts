import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext } from "../helpers.js";
import { cdCommand, homeCommand } from "../../src/commands/cd.js";

// We can't actually verify the spawned subshell exits cleanly in CI without
// embedding a shell, so these tests focus on the FAIL paths that don't spawn.

test("cd: errors when no binding", async () => {
  const t = makeContext();
  try {
    const code = await cdCommand(t.ctx);
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.startsWith("error:")));
  } finally {
    t.cleanup();
  }
});

test("cd: errors when bound path no longer exists", async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "marshal-cd-"));
  try {
    // Point the binding at a non-existent path.
    const fake = join(tmpHome, "definitely-gone");
    const t = makeContext({ preBoundTo: fake });
    const code = await cdCommand(t.ctx);
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.includes("no longer exists")));
    t.cleanup();
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("home: errors when source dir does not exist", async () => {
  const t = makeContext({ marshalSourceDir: "C:/definitely/not/a/real/path/marshal" });
  try {
    const code = await homeCommand(t.ctx);
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.includes("not found")));
  } finally {
    t.cleanup();
  }
});

// Sanity guard so eslint doesn't flag mkdirSync as unused.
void mkdirSync;
