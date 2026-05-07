import { homedir } from "node:os";
import { isAbsolute, resolve, join } from "node:path";

// Expand a leading ~ to the user's home directory. Does not touch other
// path forms. Returns absolute paths unchanged.
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") {
    return home;
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(home, p.slice(2));
  }
  return p;
}

// Resolve a (possibly ~-prefixed, possibly relative) path against a base
// (defaults to cwd). Always returns an absolute path.
export function resolvePath(p: string, base: string = process.cwd(), home: string = homedir()): string {
  const expanded = expandHome(p, home);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(base, expanded);
}

// Default location for cloned tool repos when manifest.reposPath is unset.
// Marcus's convention is ~/repos/<name>; configurable via reposPath.
export const DEFAULT_REPOS_PATH = "~/repos";
