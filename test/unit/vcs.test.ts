import { test } from "node:test";
import { strict as assert } from "node:assert";
import { makeContext } from "../helpers.js";
import { resolveBackend, DEFAULT_VCS } from "../../src/vcs.js";

test("resolveBackend: defaults to git backend", () => {
  const b = resolveBackend();
  assert.equal(b.vcs, "git");
  assert.equal(b.bin, "git");
  assert.equal(DEFAULT_VCS, "git");
});

test("resolveBackend: soda value resolves to the soda backend", () => {
  const b = resolveBackend("soda");
  assert.equal(b.vcs, "soda");
  assert.equal(b.bin, "sd");
});

test("SodaBackend.clone: runs sd clone with quoted dir in ctx.cwd", async () => {
  const t = makeContext();
  try {
    await resolveBackend("soda").clone(t.ctx, "https://x/repo.git", "C:/tmp/repo");
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, `sd clone https://x/repo.git "C:/tmp/repo"`);
    assert.equal(t.runner.calls[0].opts.cwd, t.ctx.cwd);
  } finally {
    t.cleanup();
  }
});

test("SodaBackend.pull: runs sd pull and reports changed on integration", async () => {
  const t = makeContext();
  try {
    t.runner.respond("sd pull", {
      code: 0,
      stdout: JSON.stringify({ ok: true, command: "pull", data: [{ status: "pulled", behind: 2 }] }),
    });
    const r = await resolveBackend("soda").pull(t.ctx, "C:/tmp/repo");
    assert.equal(r.changed, true);
    assert.equal(t.runner.calls[0].command, "sd pull");
    assert.equal(t.runner.calls[0].opts.cwd, "C:/tmp/repo");
  } finally {
    t.cleanup();
  }
});

test("SodaBackend.pull: reports no change when soda is up-to-date", async () => {
  const t = makeContext();
  try {
    t.runner.respond("sd pull", {
      code: 0,
      stdout: JSON.stringify({ ok: true, command: "pull", data: [{ status: "up-to-date" }] }),
    });
    const r = await resolveBackend("soda").pull(t.ctx, "C:/tmp/repo");
    assert.equal(r.changed, false);
  } finally {
    t.cleanup();
  }
});

test("SodaBackend.pull: honors inherit option", async () => {
  const t = makeContext();
  try {
    t.runner.respond("sd pull", {
      code: 0,
      stdout: JSON.stringify({ ok: true, command: "pull", data: [{ status: "up-to-date" }] }),
    });
    await resolveBackend("soda").pull(t.ctx, "C:/tmp/repo", { inherit: true });
    assert.equal(t.runner.calls[0].opts.inherit, true);
  } finally {
    t.cleanup();
  }
});

test("SodaBackend.commitFile: submits the default changelist without staging", async () => {
  const t = makeContext();
  try {
    await resolveBackend("soda").commitFile(t.ctx, "C:/tmp/repo", "marshal.json", "marshal: add repos x");
    assert.deepEqual(t.runner.calls.map((c) => c.command), [
      `sd submit -d "marshal: add repos x"`,
    ]);
    assert.equal(t.runner.calls[0].opts.cwd, "C:/tmp/repo");
  } finally {
    t.cleanup();
  }
});

test("SodaBackend.push: runs sd push", async () => {
  const t = makeContext();
  try {
    await resolveBackend("soda").push(t.ctx, "C:/tmp/repo");
    assert.equal(t.runner.calls[0].command, "sd push");
  } finally {
    t.cleanup();
  }
});

test("GitBackend.clone: runs git clone with quoted dir in ctx.cwd", async () => {
  const t = makeContext();
  try {
    await resolveBackend("git").clone(t.ctx, "https://x/repo.git", "C:/tmp/repo");
    assert.equal(t.runner.calls.length, 1);
    assert.equal(t.runner.calls[0].command, `git clone https://x/repo.git "C:/tmp/repo"`);
    assert.equal(t.runner.calls[0].opts.cwd, t.ctx.cwd);
  } finally {
    t.cleanup();
  }
});

test("GitBackend.pull: returns changed true on normal pull", async () => {
  const t = makeContext();
  try {
    t.runner.respond("git pull", { code: 0, stdout: "Updating 1234..5678\n" });
    const r = await resolveBackend("git").pull(t.ctx, "C:/tmp/repo");
    assert.equal(r.changed, true);
    assert.equal(t.runner.calls[0].command, "git pull --ff-only");
    assert.equal(t.runner.calls[0].opts.cwd, "C:/tmp/repo");
  } finally {
    t.cleanup();
  }
});

test("GitBackend.pull: returns changed false when already up to date", async () => {
  const t = makeContext();
  try {
    t.runner.respond("git pull", { code: 0, stdout: "Already up to date.\n" });
    const r = await resolveBackend("git").pull(t.ctx, "C:/tmp/repo");
    assert.equal(r.changed, false);
  } finally {
    t.cleanup();
  }
});

test("GitBackend.pull: honors inherit option", async () => {
  const t = makeContext();
  try {
    await resolveBackend("git").pull(t.ctx, "C:/tmp/repo", { inherit: true });
    assert.equal(t.runner.calls[0].opts.inherit, true);
  } finally {
    t.cleanup();
  }
});

test("GitBackend.commitFile: runs git add then git commit", async () => {
  const t = makeContext();
  try {
    await resolveBackend("git").commitFile(t.ctx, "C:/tmp/repo", "marshal.json", "marshal: add repos x");
    assert.deepEqual(t.runner.calls.map((c) => c.command), [
      "git add marshal.json",
      `git commit -m "marshal: add repos x"`,
    ]);
  } finally {
    t.cleanup();
  }
});

test("GitBackend.push: runs git push", async () => {
  const t = makeContext();
  try {
    await resolveBackend("git").push(t.ctx, "C:/tmp/repo");
    assert.equal(t.runner.calls[0].command, "git push");
  } finally {
    t.cleanup();
  }
});
