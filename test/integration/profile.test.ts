import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { profileCommand } from "../../src/commands/profile.js";

test("profile get: prints none when bound but unset", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "get");
    assert.equal(code, 0);
    assert.ok(t.log.captured.some((l) => l.includes("(none)")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile list: marks active profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await profileCommand(t.ctx, "list");
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("* work"));
    assert.ok(text.includes("  personal"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile set: validates and writes ~/.marshal.json", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work", "personal"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "set", "personal");
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.dotfilesRepo, df.dir);
    assert.equal(parsed.profile, "personal");
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile set: rejects unknown profile", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir });
  try {
    const code = await profileCommand(t.ctx, "set", "personal");
    assert.equal(code, 1);
    assert.ok(t.log.captured.some((l) => l.includes("Unknown profile")));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("profile clear: removes profile but preserves binding", async () => {
  const df = makeDotfilesRepo({ version: 1, profiles: ["work"] });
  const t = makeContext({ preBoundTo: df.dir, preBoundProfile: "work" });
  try {
    const code = await profileCommand(t.ctx, "clear");
    assert.equal(code, 0);
    const parsed = JSON.parse(readFileSync(join(t.homeDir, ".marshal.json"), "utf8"));
    assert.equal(parsed.dotfilesRepo, df.dir);
    assert.equal(parsed.profile, undefined);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});
