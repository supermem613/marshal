import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { MANIFEST_FILENAME } from "./manifest.js";

// `~/.marshal.json` — per-machine global config. Holds the absolute path of
// the dotfiles repo this machine is bound to. Single source of truth: no
// env-var fallback, no walk-up-tree discovery. Same model as rotunda.

export const BINDING_FILENAME = ".marshal.json";

export const BindingSchema = z.object({
  version: z.literal(1),
  dotfilesRepo: z.string().min(1),
});

export type Binding = z.infer<typeof BindingSchema>;

export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

export function bindingPath(home: string = homedir()): string {
  return join(home, BINDING_FILENAME);
}

export function readBinding(home: string = homedir()): Binding | null {
  const path = bindingPath(home);
  if (!existsSync(path)) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new BindingError(`Cannot read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BindingError(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }
  const result = BindingSchema.safeParse(parsed);
  if (!result.success) {
    throw new BindingError(`Invalid binding at ${path}: ${result.error.issues.map((i) => i.message).join(", ")}`);
  }
  return result.data;
}

// Validates the target directory contains a marshal.json before persisting
// the binding — refuses to bind to a non-marshal repo (rotunda convention).
export function writeBinding(dotfilesRepo: string, home: string = homedir()): Binding {
  if (!existsSync(dotfilesRepo)) {
    throw new BindingError(`Dotfiles repo path does not exist: ${dotfilesRepo}`);
  }
  const manifestPath = join(dotfilesRepo, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new BindingError(`No ${MANIFEST_FILENAME} at ${dotfilesRepo}. Create one with \`marshal init\` first.`);
  }
  const path = bindingPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const binding: Binding = { version: 1, dotfilesRepo };
  writeFileSync(path, JSON.stringify(binding, null, 2) + "\n", "utf8");
  return binding;
}

export function clearBinding(home: string = homedir()): boolean {
  const path = bindingPath(home);
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path);
  return true;
}

// Convenience: read binding and throw if missing. Used by commands that
// require a binding (sync, status, list, where, cd).
export function requireBinding(home: string = homedir()): Binding {
  const b = readBinding(home);
  if (!b) {
    throw new BindingError(
      `No binding found. Run \`marshal bind <dotfiles-url-or-path>\` first.`,
    );
  }
  return b;
}
