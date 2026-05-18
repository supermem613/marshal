import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { join } from "node:path";

// CLI smoke tests: exec the built dist/cli.js as a subprocess. These prove
// the wiring (commander, version banner, action functions) connects without
// runtime errors. Detailed behavior is covered by per-command integration
// tests that call the command functions directly.

const CLI = join(process.cwd(), "dist", "cli.js");

function run(args: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node "${CLI}" ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      code: e.status ?? -1,
    };
  }
}

test("cli: bare invocation prints version banner + help", () => {
  const r = run("");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /marshal v\d+\.\d+\.\d+/);
  assert.match(r.stdout, /Usage:/);
});

test("cli: --version prints version", () => {
  const r = run("--version");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+/);
});

test("cli: --help lists every registered subcommand", () => {
  const r = run("--help");
  assert.equal(r.code, 0);
  for (const cmd of ["doctor", "bind", "init", "sync", "status", "list", "profile", "where", "cd", "home", "update", "add", "add-app", "add-hook", "remove", "remove-app", "remove-hook"]) {
    assert.ok(r.stdout.includes(cmd), `expected --help to mention ${cmd}; got:\n${r.stdout}`);
  }
});

test("cli: sync --help mentions profile override", () => {
  const r = run("sync --help");
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes("--profile"));
});

test("cli: profile help lists actionable profile subcommands", () => {
  const r = run("help profile");
  assert.equal(r.code, 0);
  for (const snippet of [
    "profile list",
    "set <name>",
    "add [options] <name>",
    "scope [options] <kind> <profile> <items...>",
    "unscope [options] <kind> <profile> <items...>",
    "remove [options] <name>",
    "marshal profile scope repo work-laptop forge marshal -y",
    "repo    repo name from repos[]",
  ]) {
    assert.ok(r.stdout.includes(snippet), `expected profile help to mention ${snippet}; got:\n${r.stdout}`);
  }
});

test("cli: add/remove help is singular by item kind", () => {
  const addRepos = run("add --help");
  const addApps = run("add-app --help");
  const addHooks = run("add-hook --help");
  const removeRepos = run("remove --help");
  const removeApps = run("remove-app --help");
  const removeHooks = run("remove-hook --help");
  assert.equal(addRepos.code, 0);
  assert.equal(addApps.code, 0);
  assert.equal(addHooks.code, 0);
  assert.equal(removeRepos.code, 0);
  assert.equal(removeApps.code, 0);
  assert.equal(removeHooks.code, 0);
  assert.ok(addRepos.stdout.includes("<url>"));
  assert.ok(addApps.stdout.includes("<id>"));
  assert.ok(addHooks.stdout.includes("<name>"));
  assert.ok(removeRepos.stdout.includes("<repo>"));
  assert.ok(removeApps.stdout.includes("<id>"));
  assert.ok(removeHooks.stdout.includes("<name>"));
  assert.ok(addRepos.stdout.includes("Install command to run after clone or pull"));
});

test("cli: unknown command prints commander error and exits non-zero", () => {
  const r = run("nonsense-command");
  assert.notEqual(r.code, 0);
});

test("cli: doctor --json emits parseable JSON", () => {
  const r = run("doctor --json");
  // doctor exits 1 if any check fails (likely no binding in clean home),
  // so we tolerate non-zero but require JSON.
  const parsed = JSON.parse(r.stdout);
  assert.equal(typeof parsed.ok, "boolean");
  assert.ok(Array.isArray(parsed.checks));
});

test("cli: bind --show with no binding warns + exits non-zero", () => {
  const r = run("bind --show");
  assert.notEqual(r.code, 0);
});
