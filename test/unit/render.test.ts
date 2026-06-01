import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CaptureLogger } from "../../src/ui/log.js";
import { renderPlan, renderResults } from "../../src/render.js";
import { Plan } from "../../src/plan.js";

const emptyPlan: Plan = {
  apps: [],
  repos: [],
  hooks: [],
  reposPath: "/x",
  platform: "win32",
  activeProfile: { profile: null, source: "none" },
};

test("renderPlan: prints nothing-to-do for empty plan", () => {
  const log = new CaptureLogger();
  renderPlan(emptyPlan, log);
  assert.ok(log.captured.some((l) => l.includes("nothing to do")));
});

test("renderPlan: lists apps + repos", () => {
  const log = new CaptureLogger();
  const plan: Plan = {
    apps: [{ id: "Git.Git" }],
    repos: [
      {
        name: "tool-alpha",
        url: "https://x",
        targetDir: "/r/tool-alpha",
        installCwd: "/r/tool-alpha",
        installCmd: "i",
        updateCmd: null,
        action: "clone-and-install",
        exists: false,
      },
    ],
    hooks: [{
      name: "config-sync",
      stage: "post-repos",
      command: "configsync sync",
      cwd: "/dotfiles",
      interactive: true,
    }],
    reposPath: "/r",
    platform: "win32",
    activeProfile: { profile: "work", source: "binding" },
  };
  renderPlan(plan, log);
  const text = log.captured.join("\n");
  assert.ok(text.includes("profile: work (binding)"));
  assert.ok(text.includes("Git.Git"));
  assert.ok(text.includes("tool-alpha"));
  assert.ok(text.includes("CLONE + INSTALL"));
  assert.ok(text.includes("config-sync"));
  assert.ok(text.includes("[interactive]"));
});

test("renderResults: tallies pass/fail", () => {
  const log = new CaptureLogger();
  renderResults(
    [
      { step: "a", ok: true },
      { step: "b", ok: false, detail: "oops" },
    ],
    log,
  );
  const text = log.captured.join("\n");
  assert.ok(text.includes("1 ok, 1 failed"));
  assert.ok(text.includes("oops"));
});

test("renderResults: skipped items shown separately from pass/fail", () => {
  const log = new CaptureLogger();
  renderResults(
    [
      { step: "app: Git.Git", ok: true, skipped: true, detail: "winget not available on darwin" },
      { step: "app: jqlang.jq", ok: true, skipped: true, detail: "winget not available on darwin" },
      { step: "repo: tools", ok: true, detail: "cloned" },
      { step: "hook: sync", ok: false, detail: "command failed" },
    ],
    log,
  );
  const text = log.captured.join("\n");
  assert.ok(text.includes("1 ok, 1 failed, 2 skipped"));
  assert.ok(text.includes("⊘ app: Git.Git"));
  assert.ok(text.includes("⊘ app: jqlang.jq"));
});

test("renderResults: no skipped label when nothing is skipped", () => {
  const log = new CaptureLogger();
  renderResults(
    [
      { step: "repo: a", ok: true },
      { step: "repo: b", ok: true },
    ],
    log,
  );
  const text = log.captured.join("\n");
  assert.ok(text.includes("2 ok, 0 failed"));
  assert.ok(!text.includes("skipped"));
});

test("renderResults: all skipped means 0 ok 0 failed N skipped", () => {
  const log = new CaptureLogger();
  renderResults(
    [
      { step: "app: X", ok: true, skipped: true },
    ],
    log,
  );
  const text = log.captured.join("\n");
  assert.ok(text.includes("0 ok, 0 failed, 1 skipped"));
});
