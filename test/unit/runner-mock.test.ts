import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MockProcessRunner } from "../../src/runners/mock.js";
import { ProcessError } from "../../src/runners/types.js";

test("MockProcessRunner: returns default response", async () => {
  const r = new MockProcessRunner();
  const out = await r.exec("anything");
  assert.equal(out.code, 0);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].command, "anything");
});

test("MockProcessRunner: matches by string prefix", async () => {
  const r = new MockProcessRunner().respond("git clone", { stdout: "Cloning..." });
  const out = await r.exec("git clone https://x");
  assert.equal(out.stdout, "Cloning...");
});

test("MockProcessRunner: matches by regex", async () => {
  const r = new MockProcessRunner().respond(/^npm /, { stdout: "npm out" });
  const out = await r.exec("npm install");
  assert.equal(out.stdout, "npm out");
});

test("MockProcessRunner: falls through to default on no match", async () => {
  const r = new MockProcessRunner()
    .respond("git", { stdout: "g" })
    .setDefault({ stdout: "default" });
  const out = await r.exec("npm install");
  assert.equal(out.stdout, "default");
});

test("MockProcessRunner: fail:true throws ProcessError", async () => {
  const r = new MockProcessRunner().respond("bad", { fail: true, code: 5 });
  await assert.rejects(() => r.exec("bad cmd"), ProcessError);
});

test("MockProcessRunner: respects opts.cwd in result", async () => {
  const r = new MockProcessRunner();
  const out = await r.exec("ls", { cwd: "/some/where" });
  assert.equal(out.cwd, "/some/where");
});

test("MockProcessRunner: reset clears calls and matchers", async () => {
  const r = new MockProcessRunner().respond("x", { stdout: "y" });
  await r.exec("x");
  r.reset();
  assert.equal(r.calls.length, 0);
  const out = await r.exec("x");
  assert.equal(out.stdout, "");
});
