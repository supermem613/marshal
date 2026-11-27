import { existsSync } from "node:fs";
import { join } from "node:path";
import { Manifest, Repo, App, Npm, Hook, Setup } from "./manifest.js";
import { Platform, appliesToPlatform } from "./platform.js";
import { resolvePath, expandHome, DEFAULT_REPOS_PATH } from "./paths.js";
import { ActiveProfile, profileApplies } from "./profile.js";
import { Vcs, DEFAULT_VCS } from "./vcs.js";

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
  vcs: Vcs;
}

export interface AppStep {
  id: string;
}

export interface NpmStep {
  name: string;
}

export interface HookStep {
  name: string;
  stage: "post-repos";
  command: string;
  cwd: string;
  interactive: boolean;
}

export interface SetupStep {
  name: string;
  command: string;
  checkCmd: string | null;
  cwd: string;
  interactive: boolean;
}

export type ReposPathSource = "binding" | "manifest" | "default";

export interface ResolvedReposPath {
  path: string;
  source: ReposPathSource;
}

export interface Plan {
  apps: AppStep[];
  npm: NpmStep[];
  repos: RepoStep[];
  hooks: HookStep[];
  setup: SetupStep[];
  reposPath: string;                // absolute path of the resolved reposPath (for display)
  reposPathSource?: ReposPathSource;
  platform: Platform;
  activeProfile: ActiveProfile;
}

export interface BuildPlanOptions {
  homeDir: string;
  dotfilesRepo: string;
  platform: Platform;
  // Optional per-machine reposPath from ~/.marshal.json; overrides manifest.reposPath.
  reposPath?: string;
  // Filter — if non-empty, only repos whose names appear here are included.
  // (apps unchanged.) Used by `marshal sync <name1> <name2>`.
  repoFilter?: string[];
  includeHooks?: boolean;
  // Setup steps are one-time machine bootstrap and never run during a plain
  // sync. Only `marshal setup` opts in via includeSetup.
  includeSetup?: boolean;
  activeProfile?: ActiveProfile;
}

export function resolveReposPathWithSource(
  manifest: Manifest,
  homeDir: string,
  bindingReposPath?: string,
): ResolvedReposPath {
  if (bindingReposPath) {
    return {
      path: resolvePath(expandHome(bindingReposPath, homeDir), homeDir, homeDir),
      source: "binding",
    };
  }
  if (manifest.reposPath) {
    return {
      path: resolvePath(expandHome(manifest.reposPath, homeDir), homeDir, homeDir),
      source: "manifest",
    };
  }
  return {
    path: resolvePath(expandHome(DEFAULT_REPOS_PATH, homeDir), homeDir, homeDir),
    source: "default",
  };
}

export function resolveReposPath(manifest: Manifest, homeDir: string, bindingReposPath?: string): string {
  return resolveReposPathWithSource(manifest, homeDir, bindingReposPath).path;
}

export function buildPlan(manifest: Manifest, opts: BuildPlanOptions): Plan {
  const { path: reposPath, source: reposPathSource } = resolveReposPathWithSource(
    manifest,
    opts.homeDir,
    opts.reposPath,
  );
  const filter = opts.repoFilter && opts.repoFilter.length > 0 ? new Set(opts.repoFilter) : null;
  const activeProfile = opts.activeProfile ?? { profile: null, source: "none" };

  const apps: AppStep[] = manifest.apps
    .filter((a: App) => appliesToPlatform(a.platforms as Platform[] | undefined, opts.platform))
    .filter((a) => profileApplies(a.profiles, activeProfile.profile))
    .map((a) => ({ id: a.id }));

  const npm: NpmStep[] = manifest.npm
    .filter((n: Npm) => appliesToPlatform(n.platforms as Platform[] | undefined, opts.platform))
    .filter((n) => profileApplies(n.profiles, activeProfile.profile))
    .map((n) => ({ name: n.name }));

  const repos: RepoStep[] = manifest.repos
    .filter((r: Repo) => appliesToPlatform(r.platforms as Platform[] | undefined, opts.platform))
    .filter((r) => profileApplies(r.profiles, activeProfile.profile))
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
        // Per-repo vcs is explicit or defaults to git. The top-level manifest
        // vcs governs only marshal self-update, never the fleet default.
        vcs: r.vcs ?? DEFAULT_VCS,
      };
    });

  const hooks: HookStep[] = opts.includeHooks === false
    ? []
    : manifest.hooks
      .filter((h: Hook) => appliesToPlatform(h.platforms as Platform[] | undefined, opts.platform))
      .filter((h) => profileApplies(h.profiles, activeProfile.profile))
      .map((h) => ({
        name: h.name,
        stage: h.stage,
        command: h.cmd,
        cwd: h.cwd ? join(opts.dotfilesRepo, h.cwd) : opts.dotfilesRepo,
        interactive: h.interactive,
      }));

  const setup: SetupStep[] = opts.includeSetup !== true
    ? []
    : manifest.setup
      .filter((s: Setup) => appliesToPlatform(s.platforms as Platform[] | undefined, opts.platform))
      .filter((s) => profileApplies(s.profiles, activeProfile.profile))
      .map((s) => ({
        name: s.name,
        command: s.cmd,
        checkCmd: s.check_cmd ?? null,
        cwd: opts.dotfilesRepo,
        interactive: s.interactive,
      }));

  return { apps, npm, repos, hooks, setup, reposPath, reposPathSource, platform: opts.platform, activeProfile };
}

// Verify a filter resolved to all real repo names — surface typos before
// any work is done. Returns names from `requested` that don't appear in the
// (platform-filtered) manifest.
export function unknownRepoNames(
  manifest: Manifest,
  platform: Platform,
  requested: readonly string[],
  activeProfile?: string | null,
): string[] {
  const known = new Set(
    manifest.repos
      .filter((r) => appliesToPlatform(r.platforms as Platform[] | undefined, platform))
      .filter((r) => activeProfile === undefined || profileApplies(r.profiles, activeProfile))
      .map((r) => r.name),
  );
  return requested.filter((n) => !known.has(n));
}
