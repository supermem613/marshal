import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindingPath,
  readBinding,
  writeBinding,
  clearBinding,
  requireBinding,
  BindingError,
} from "../../src/binding.js";

function fresh(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "marshal-binding-"));
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function makeDotfiles(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "marshal-df-"));
  writeFileSync(join(dir, "marshal.json"), JSON.stringify({ version: 1 }));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("bindingPath joins home + .marshal.json", () => {
  const p = bindingPath("/home/u").replace(/\\/g, "/");
  assert.equal(p, "/home/u/.marshal.json");
});

test("readBinding returns null when file absent", () => {
  const { home, cleanup } = fresh();
  try {
    assert.equal(readBinding(home), null);
  } finally {
    cleanup();
  }
});

test("readBinding throws on invalid JSON", () => {
  const { home, cleanup } = fresh();
  try {
    writeFileSync(bindingPath(home), "{notjson");
    assert.throws(() => readBinding(home), BindingError);
  } finally {
    cleanup();
  }
});

test("readBinding throws on schema violation", () => {
  const { home, cleanup } = fresh();
  try {
    writeFileSync(bindingPath(home), JSON.stringify({ version: 99, dotfilesRepo: "/x" }));
    assert.throws(() => readBinding(home), BindingError);
  } finally {
    cleanup();
  }
});

test("readBinding accepts profile field", () => {
  const { home, cleanup } = fresh();
  try {
    writeFileSync(bindingPath(home), JSON.stringify({ version: 1, dotfilesRepo: "/x", profile: "work-laptop" }));
    const b = readBinding(home);
    assert.equal(b?.profile, "work-laptop");
  } finally {
    cleanup();
  }
});

test("writeBinding refuses non-existent dotfiles dir", () => {
  const { home, cleanup } = fresh();
  try {
    assert.throws(() => writeBinding("/no/such/dir", home), BindingError);
  } finally {
    cleanup();
  }
});

test("writeBinding refuses dotfiles dir without marshal.json", () => {
  const { home, cleanup } = fresh();
  const empty = mkdtempSync(join(tmpdir(), "marshal-noman-"));
  try {
    assert.throws(() => writeBinding(empty, home), BindingError);
  } finally {
    cleanup();
    rmSync(empty, { recursive: true, force: true });
  }
});

test("writeBinding then readBinding roundtrip", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    const w = writeBinding(df.dir, home);
    assert.equal(w.dotfilesRepo, df.dir);
    const r = readBinding(home);
    assert.deepEqual(r, w);
  } finally {
    cleanup();
    df.cleanup();
  }
});

test("writeBinding preserves existing profile", () => {
  const { home, cleanup } = fresh();
  const df1 = makeDotfiles();
  const df2 = makeDotfiles();
  try {
    writeFileSync(bindingPath(home), JSON.stringify({ version: 1, dotfilesRepo: df1.dir, profile: "work" }));
    const w = writeBinding(df2.dir, home);
    assert.equal(w.dotfilesRepo, df2.dir);
    assert.equal(w.profile, "work");
  } finally {
    cleanup();
    df1.cleanup();
    df2.cleanup();
  }
});

test("clearBinding removes file when present", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    writeBinding(df.dir, home);
    assert.ok(existsSync(bindingPath(home)));
    assert.equal(clearBinding(home), true);
    assert.equal(existsSync(bindingPath(home)), false);
    assert.equal(clearBinding(home), false);
  } finally {
    cleanup();
    df.cleanup();
  }
});

test("requireBinding throws when no binding", () => {
  const { home, cleanup } = fresh();
  try {
    assert.throws(() => requireBinding(home), BindingError);
  } finally {
    cleanup();
  }
});

test("requireBinding returns binding when set", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    writeBinding(df.dir, home);
    const b = requireBinding(home);
    assert.equal(b.dotfilesRepo, df.dir);
  } finally {
    cleanup();
    df.cleanup();
  }
});

// Sanity guard so eslint doesn't flag mkdirSync as unused (it's intentionally
// imported for future tests that need to construct partially-formed repos).
void mkdirSync;
