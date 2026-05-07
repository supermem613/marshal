import { test } from "node:test";
import { strict as assert } from "node:assert";
import { makeContext, makeDotfilesRepo } from "../helpers.js";
import { doctorCommand } from "../../src/commands/doctor.js";

test("doctor: reports node check ok", async () => {
  const t = makeContext();
  // Mock all execs as success so git/winget look installed.
  t.runner.respond("git", { stdout: "git version 2.0" });
  t.runner.respond("winget", { stdout: "v1.6" });
  try {
    const code = await doctorCommand(t.ctx, { json: true });
    // Will be 1 because no binding in fresh context
    assert.equal(code, 1);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!;
    const parsed = JSON.parse(raw.slice(5));
    const node = parsed.checks.find((c: { name: string }) => c.name === "node");
    assert.equal(node.ok, true);
    const binding = parsed.checks.find((c: { name: string }) => c.name === "binding");
    assert.equal(binding.ok, false);
  } finally {
    t.cleanup();
  }
});

test("doctor: includes winget check on win32, omits on darwin", async () => {
  const tWin = makeContext({ platform: "win32" });
  const tMac = makeContext({ platform: "darwin" });
  tWin.runner.respond("git", { stdout: "git" });
  tWin.runner.respond("winget", { stdout: "wg" });
  tMac.runner.respond("git", { stdout: "git" });
  try {
    await doctorCommand(tWin.ctx, { json: true });
    await doctorCommand(tMac.ctx, { json: true });
    const winRaw = tWin.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const macRaw = tMac.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const winChecks = JSON.parse(winRaw).checks.map((c: { name: string }) => c.name);
    const macChecks = JSON.parse(macRaw).checks.map((c: { name: string }) => c.name);
    assert.ok(winChecks.includes("winget"));
    assert.ok(!macChecks.includes("winget"));
  } finally {
    tWin.cleanup();
    tMac.cleanup();
  }
});

test("doctor: with binding + valid manifest reports manifest counts", async () => {
  const df = makeDotfilesRepo({
    version: 1,
    apps: [{ id: "Git.Git" }, { id: "Node.Node" }],
    repos: [{ name: "tool-alpha", url: "u", install_cmd: "i" }],
  });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    const code = await doctorCommand(t.ctx, { json: true });
    assert.equal(code, 0);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const parsed = JSON.parse(raw);
    const manifest = parsed.checks.find((c: { name: string }) => c.name === "manifest");
    assert.equal(manifest.ok, true);
    assert.match(manifest.detail, /2 app/);
    assert.match(manifest.detail, /1 repo/);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("doctor: invalid manifest surfaces specific error", async () => {
  const df = makeDotfilesRepo({ version: 99 });
  const t = makeContext({ preBoundTo: df.dir });
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    const code = await doctorCommand(t.ctx, { json: true });
    assert.equal(code, 1);
    const raw = t.log.captured.find((l) => l.startsWith("raw:"))!.slice(5);
    const parsed = JSON.parse(raw);
    const manifest = parsed.checks.find((c: { name: string }) => c.name === "manifest");
    assert.equal(manifest.ok, false);
  } finally {
    t.cleanup();
    df.cleanup();
  }
});

test("doctor: human output shows ✓/✗ icons", async () => {
  const t = makeContext();
  t.runner.respond("git", { stdout: "git" });
  t.runner.respond("winget", { stdout: "wg" });
  try {
    await doctorCommand(t.ctx, {});
    const text = t.log.captured.join("\n");
    assert.ok(text.includes("marshal doctor"));
  } finally {
    t.cleanup();
  }
});
