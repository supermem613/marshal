import { existsSync } from "node:fs";
import { join } from "node:path";
import { Manifest, Repo, App, Hook } from "./manifest.js";
import { Platform, appliesToPlatform } from "./platform.js";
import { resolvePath, expandHome, DEFAULT_REPOS_PATH } from "./paths.js";

// "Plan, then apply" is marshal's safety contract. buildPlan is a pure
// function: read filesystem state once, return a complete description of
// what sync would do. Tests can construct manifests, build plans, and
// assert on the shape without touching exec or git.

export type RepoAction =
  | "clone-and-install"   // doesn't exist yet — clone + run install_cmd
  | "clone"               // doesn't exist yet, no install_cmd — clone only
  | "update"              // exists, has update_cmd — run update_cmd
  | "pull-and-install"    // exists, no update_cmd — git pull + install_cmd
  | "pull";               // exists, no update_cmd, no install_cmd — git pull only

export interface RepoStep {
  name: string;
  url: string;
  targetDir: string;     // absolute path of the cloned repo root
  installCwd: string;    // absolute path where install_cmd / update_cmd runs (may equal targetDir or a subdir)
  installCmd: string | null;
  updateCmd: string | null;
  action: RepoAction;
  exists: boolean;
}

export interface AppStep {
  id: string;
}

export interface HookStep {
  name: string;
  stage: "post-repos";
  command: string;
  cwd: string;
  interactive: boolean;
}

export interface Plan {
  apps: AppStep[];
  repos: RepoStep[];
  hooks: HookStep[];
  reposPath: string;     // absolute path of the resolved reposPath (for display)
  platform: Platform;
}

export interface BuildPlanOptions {
  homeDir: string;
  dotfilesRepo: string;
  platform: Platform;
  // Filter — if non-empty, only repos whose names appear here are included.
  // (apps unchanged.) Used by `marshal sync <name1> <name2>`.
  repoFilter?: string[];
  includeHooks?: boolean;
}

export function resolveReposPath(manifest: Manifest, homeDir: string): string {
  const raw = manifest.reposPath ?? DEFAULT_REPOS_PATH;
  return resolvePath(expandHome(raw, homeDir), homeDir, homeDir);
}

export function buildPlan(manifest: Manifest, opts: BuildPlanOptions): Plan {
  const reposPath = resolveReposPath(manifest, opts.homeDir);
  const filter = opts.repoFilter && opts.repoFilter.length > 0 ? new Set(opts.repoFilter) : null;

  const apps: AppStep[] = manifest.apps
    .filter((a: App) => appliesToPlatform(a.platforms as Platform[] | undefined, opts.platform))
    .map((a) => ({ id: a.id }));

  const repos: RepoStep[] = manifest.repos
    .filter((r: Repo) => appliesToPlatform(r.platforms as Platform[] | undefined, opts.platform))
    .filter((r) => !filter || filter.has(r.name))
    .map((r) => {
      const targetDir = join(reposPath, r.name);
      const installCwd = r.install_cwd
        ? join(targetDir, r.install_cwd)
        : targetDir;
      const exists = existsSync(targetDir);
      const installCmd = r.install_cmd ?? null;
      const updateCmd = r.update_cmd ?? null;
      let action: RepoAction;
      if (!exists) {
        action = installCmd ? "clone-and-install" : "clone";
      } else if (updateCmd) {
        action = "update";
      } else {
        action = installCmd ? "pull-and-install" : "pull";
      }
      return {
        name: r.name,
        url: r.url,
        targetDir,
        installCwd,
        installCmd,
        updateCmd,
        action,
        exists,
      };
    });

  const hooks: HookStep[] = opts.includeHooks === false
    ? []
    : manifest.hooks
      .filter((h: Hook) => appliesToPlatform(h.platforms as Platform[] | undefined, opts.platform))
      .map((h) => ({
        name: h.name,
        stage: h.stage,
        command: h.cmd,
        cwd: h.cwd ? join(opts.dotfilesRepo, h.cwd) : opts.dotfilesRepo,
        interactive: h.interactive,
      }));

  return { apps, repos, hooks, reposPath, platform: opts.platform };
}

// Verify a filter resolved to all real repo names — surface typos before
// any work is done. Returns names from `requested` that don't appear in the
// (platform-filtered) manifest.
export function unknownRepoNames(
  manifest: Manifest,
  platform: Platform,
  requested: readonly string[],
): string[] {
  const known = new Set(
    manifest.repos
      .filter((r) => appliesToPlatform(r.platforms as Platform[] | undefined, platform))
      .map((r) => r.name),
  );
  return requested.filter((n) => !known.has(n));
}
