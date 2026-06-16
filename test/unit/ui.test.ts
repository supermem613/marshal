import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CaptureLogger } from "../../src/ui/log.js";
import { CannedPrompter } from "../../src/ui/prompt.js";

test("CaptureLogger: records all severities", () => {
  const log = new CaptureLogger();
  log.info("i");
  log.warn("w");
  log.error("e");
  log.success("s");
  log.dim("d");
  log.raw("r");
  assert.deepEqual(log.captured, [
    "info: i",
    "warn: w",
    "error: e",
    "success: s",
    "dim: d",
    "raw: r",
  ]);
});

test("CannedPrompter: returns answers in order", async () => {
  const p = new CannedPrompter([true, false]);
  assert.equal(await p.confirm("q1"), true);
  assert.equal(await p.confirm("q2"), false);
  assert.deepEqual(p.questions, ["q1", "q2"]);
});

test("CannedPrompter: throws when exhausted", async () => {
  const p = new CannedPrompter([]);
  await assert.rejects(() => p.confirm("oops"), /exhausted/);
});

test("CannedPrompter: select returns canned choices in order", async () => {
  const p = new CannedPrompter([], ["work", "personal"]);
  assert.equal(await p.select("pick", ["work", "personal"]), "work");
  assert.equal(await p.select("pick", ["work", "personal"]), "personal");
  assert.deepEqual(p.selectQuestions, ["pick", "pick"]);
});

test("CannedPrompter: select throws when exhausted", async () => {
  const p = new CannedPrompter([], []);
  await assert.rejects(() => p.select("pick", ["a"]), /exhausted/);
});

test("CannedPrompter: select rejects a choice not in the offered list", async () => {
  const p = new CannedPrompter([], ["ghost"]);
  await assert.rejects(() => p.select("pick", ["a", "b"]), /not in choices/);
});
