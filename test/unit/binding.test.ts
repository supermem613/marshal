import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindingPath,
  readBinding,
  writeBinding,
  writeBindingProfile,
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

test("readBinding: preserves a declared vcs value", () => {
  const f = fresh();
  try {
    writeFileSync(bindingPath(f.home), JSON.stringify({ version: 1, dotfilesRepo: "C:/df", vcs: "soda" }));
    const b = readBinding(f.home);
    assert.equal(b?.vcs, "soda");
  } finally {
    f.cleanup();
  }
});

test("readBinding: rejects an unknown vcs value", () => {
  const f = fresh();
  try {
    writeFileSync(bindingPath(f.home), JSON.stringify({ version: 1, dotfilesRepo: "C:/df", vcs: "hg" }));
    assert.throws(() => readBinding(f.home), BindingError);
  } finally {
    f.cleanup();
  }
});

test("writeBinding sets vcs when provided and roundtrips", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    const w = writeBinding(df.dir, home, "soda");
    assert.equal(w.vcs, "soda");
    const r = readBinding(home);
    assert.equal(r?.vcs, "soda");
  } finally {
    cleanup();
    df.cleanup();
  }
});

test("writeBinding preserves an existing vcs when none is provided", () => {
  const { home, cleanup } = fresh();
  const df1 = makeDotfiles();
  const df2 = makeDotfiles();
  try {
    writeFileSync(bindingPath(home), JSON.stringify({ version: 1, dotfilesRepo: df1.dir, vcs: "soda" }));
    const w = writeBinding(df2.dir, home);
    assert.equal(w.dotfilesRepo, df2.dir);
    assert.equal(w.vcs, "soda");
  } finally {
    cleanup();
    df1.cleanup();
    df2.cleanup();
  }
});

test("writeBinding overrides an existing vcs when a new one is provided", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    writeFileSync(bindingPath(home), JSON.stringify({ version: 1, dotfilesRepo: df.dir, vcs: "soda" }));
    const w = writeBinding(df.dir, home, "git");
    assert.equal(w.vcs, "git");
  } finally {
    cleanup();
    df.cleanup();
  }
});

test("writeBindingProfile preserves an existing vcs", () => {
  const { home, cleanup } = fresh();
  const df = makeDotfiles();
  try {
    writeBinding(df.dir, home, "soda");
    const w = writeBindingProfile("work", home);
    assert.equal(w.profile, "work");
    assert.equal(w.vcs, "soda");
  } finally {
    cleanup();
    df.cleanup();
  }
});

// Sanity guard so eslint doesn't flag mkdirSync as unused (it's intentionally
// imported for future tests that need to construct partially-formed repos).
void mkdirSync;
