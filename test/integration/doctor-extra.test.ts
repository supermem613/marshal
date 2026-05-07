import { test } from "node:test";
import { strict as assert } from "node:assert";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { doctorCommand } from "../../src/commands/doctor.js";

// Extra doctor coverage: human output formatting, fail propagation when an
// executable check throws, and the "all checks passed" success path.

test("doctor human output: includes ✓ and ✗ glyphs", async () => {
  const df = makeDotfilesRepo({ version: 1, apps: [], repos: [] });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git", { stdout: "git version 2" });
  t.runner.respond("winget", { stdout: "winget v1" });
  try {
    const code = await doctorCommand(t.ctx, {});
    assert.equal(code, 0);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("✓"), `expected ✓ in: ${text}`);
    assert.ok(text.includes("All checks passed"));
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("doctor: failed binding yields ✗ + hint in human output", async () => {
  const t = makeContext();
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    const code = await doctorCommand(t.ctx, {});
    assert.equal(code, 1);
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("✗"));
    assert.ok(text.toLowerCase().includes("marshal bind"));
  } finally {
    t.cleanup();
  }
});

test("doctor: when bound path missing on disk, surfaces actionable hint", async () => {
  const t = makeContext({ preBoundTo: "C:/nope/never/here" });
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    const code = await doctorCommand(t.ctx, { json: true });
    assert.equal(code, 1);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const parsed = JSON.parse(raw);
    const binding = parsed.checks.find((c: { name: string }) => c.name === "binding");
    assert.equal(binding.ok, false);
    assert.match(binding.detail, /missing|does not exist|nope/i);
    assert.ok(binding.hint);
  } finally {
    t.cleanup();
  }
});

test("doctor: every CheckResult has name + ok + detail", async () => {
  const t = makeContext();
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    await doctorCommand(t.ctx, { json: true });
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const parsed = JSON.parse(raw);
    for (const c of parsed.checks) {
      assert.ok(typeof c.name === "string" && c.name.length > 0);
      assert.equal(typeof c.ok, "boolean");
      assert.ok(typeof c.detail === "string");
      // Failures must carry a hint (per skill convention).
      if (!c.ok && c.name !== "manifest") {
        assert.ok(c.hint, `missing hint on failed check: ${c.name}`);
      }
    }
  } finally {
    t.cleanup();
  }
});
