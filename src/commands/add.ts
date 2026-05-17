import { writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
import { ProcessError } from "../runners/types.js";
import {
  readManifest,
  ManifestError,
  MANIFEST_FILENAME,
  validateManifest,
  Repo,
  App,
  Hook,
  Manifest,
} from "../manifest.js";
import { syncCommand } from "./sync.js";
import { Platform, SUPPORTED_PLATFORMS } from "../platform.js";
import { pullDotfilesRepo } from "../dotfiles-git.js";

export interface AddOptions {
  install_cmd?: string;
  update_cmd?: string;
  install_cwd?: string;
  platforms?: string[];
  profiles?: string[];
  yes?: boolean;
  sync?: boolean;
  noSync?: boolean;
}

export async function addCommand(
  ctx: MarshalContext,
  url: string | string[],
  name: string | undefined,
  opts: AddOptions,
): Promise<number> {
  const entries = Array.isArray(url)
    ? url.map((u) => ({ url: u }))
    : [{ url, name }];
  return addReposCommand(ctx, entries, opts);
}

export async function addReposCommand(
  ctx: MarshalContext,
  entries: Array<{ url: string; name?: string }>,
  opts: AddOptions,
): Promise<number> {
  const loaded = await loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;

  if (entries.length === 0) {
    ctx.log.error("No repos provided.");
    return 2;
  }
  const resolved = entries.map((entry) => ({
    ...entry,
    name: entry.name ?? deriveName(entry.url),
  }));
  const duplicateNames = findDuplicates(resolved.map((entry) => entry.name));
  if (duplicateNames.length > 0) {
    ctx.log.error(`Duplicate repo name(s): ${duplicateNames.join(", ")}`);
    return 1;
  }
  const existing = resolved.filter((entry) => manifest.repos.some((r) => r.name === entry.name));
  if (existing.length > 0) {
    ctx.log.error(`Repo(s) already in manifest: ${existing.map((entry) => entry.name).join(", ")}`);
    return 1;
  }
  const platforms = parsePlatforms(opts.platforms);
  if (platforms && "code" in platforms) {
    ctx.log.error(platforms.message);
    return platforms.code;
  }
  const newRepos: Repo[] = resolved.map((entry) => ({
    name: entry.name,
    url: entry.url,
    ...(opts.install_cmd ? { install_cmd: opts.install_cmd } : {}),
    ...(opts.install_cwd ? { install_cwd: opts.install_cwd } : {}),
    ...(opts.update_cmd ? { update_cmd: opts.update_cmd } : {}),
    ...(platforms && platforms.length > 0
      ? { platforms }
      : {}),
    ...(opts.profiles && opts.profiles.length > 0 ? { profiles: opts.profiles } : {}),
  }));
  const next: Manifest = {
    ...manifest,
    repos: [...manifest.repos, ...newRepos],
  };
  validateManifest(next);

  ctx.log.info(`Will add ${newRepos.length} repo(s) to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newRepos.length === 1 ? newRepos[0] : newRepos, null, 2));

  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const path = join(bound, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);
  await commitAndPush(ctx, bound, `marshal: add repos ${newRepos.map((repo) => repo.name).join(", ")}`);

  if (!opts.sync) {
    ctx.log.info("Run `marshal sync` to apply.");
    return 0;
  }
  return await syncCommand(ctx, { yes: opts.yes ?? false, repos: newRepos.map((repo) => repo.name) });
}

export interface AddAppOptions {
  platforms?: string[];
  profiles?: string[];
  yes?: boolean;
  sync?: boolean;
}

export async function addAppCommand(
  ctx: MarshalContext,
  id: string | string[],
  opts: AddAppOptions,
): Promise<number> {
  return addAppsCommand(ctx, Array.isArray(id) ? id : [id], opts);
}

export async function addAppsCommand(
  ctx: MarshalContext,
  ids: string[],
  opts: AddAppOptions,
): Promise<number> {
  const loaded = await loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;
  if (ids.length === 0) {
    ctx.log.error("No apps provided.");
    return 2;
  }
  const duplicates = findDuplicates(ids);
  if (duplicates.length > 0) {
    ctx.log.error(`Duplicate app id(s): ${duplicates.join(", ")}`);
    return 1;
  }
  const existing = ids.filter((id) => manifest.apps.some((a) => a.id === id));
  if (existing.length > 0) {
    ctx.log.error(`App(s) already in manifest: ${existing.join(", ")}`);
    return 1;
  }
  const platforms = parsePlatforms(opts.platforms);
  if (platforms && "code" in platforms) {
    ctx.log.error(platforms.message);
    return platforms.code;
  }
  const newApps: App[] = ids.map((id) => ({
    id,
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
    ...(opts.profiles && opts.profiles.length > 0 ? { profiles: opts.profiles } : {}),
  }));
  const next: Manifest = {
    ...manifest,
    apps: [...manifest.apps, ...newApps],
  };
  validateManifest(next);

  ctx.log.info(`Will add ${newApps.length} app(s) to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newApps.length === 1 ? newApps[0] : newApps, null, 2));

  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const path = join(bound, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);
  await commitAndPush(ctx, bound, `marshal: add apps ${ids.join(", ")}`);

  if (!opts.sync) {
    ctx.log.info("Run `marshal sync` to apply.");
    return 0;
  }
  return await syncCommand(ctx, { yes: opts.yes ?? false });
}

export interface AddHookOptions {
  cmd: string;
  cwd?: string;
  platforms?: string[];
  profiles?: string[];
  interactive?: boolean;
  yes?: boolean;
  sync?: boolean;
}

export async function addHookCommand(
  ctx: MarshalContext,
  name: string | string[],
  opts: AddHookOptions,
): Promise<number> {
  return addHooksCommand(ctx, Array.isArray(name) ? name : [name], opts);
}

export async function addHooksCommand(
  ctx: MarshalContext,
  names: string[],
  opts: AddHookOptions,
): Promise<number> {
  const loaded = await loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;
  if (names.length === 0) {
    ctx.log.error("No hooks provided.");
    return 2;
  }
  const duplicates = findDuplicates(names);
  if (duplicates.length > 0) {
    ctx.log.error(`Duplicate hook name(s): ${duplicates.join(", ")}`);
    return 1;
  }
  const existing = names.filter((name) => manifest.hooks.some((h) => h.name === name));
  if (existing.length > 0) {
    ctx.log.error(`Hook(s) already in manifest: ${existing.join(", ")}`);
    return 1;
  }
  const platforms = parsePlatforms(opts.platforms);
  if (platforms && "code" in platforms) {
    ctx.log.error(platforms.message);
    return platforms.code;
  }
  if (opts.cwd && !isValidHookCwd(opts.cwd)) {
    ctx.log.error("Hook cwd must be a relative path inside the bound dotfiles repo.");
    return 1;
  }
  const newHooks: Hook[] = names.map((name) => ({
    name,
    stage: "post-repos",
    cmd: opts.cmd,
    interactive: opts.interactive ?? false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
    ...(opts.profiles && opts.profiles.length > 0 ? { profiles: opts.profiles } : {}),
  }));
  const next: Manifest = {
    ...manifest,
    hooks: [...manifest.hooks, ...newHooks],
  };
  validateManifest(next);

  ctx.log.info(`Will add ${newHooks.length} hook(s) to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newHooks.length === 1 ? newHooks[0] : newHooks, null, 2));

  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const path = join(bound, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);
  await commitAndPush(ctx, bound, `marshal: add hooks ${names.join(", ")}`);

  if (!opts.sync) {
    ctx.log.info("Run `marshal sync` to apply.");
    return 0;
  }
  return await syncCommand(ctx, { yes: opts.yes ?? false });
}

export interface RemoveOptions {
  yes?: boolean;
  // Default true: physically delete the cloned repo dir after removing from
  // manifest. Pass --keep-files to leave it in place.
  deleteFiles?: boolean;
  apps?: string[];
  hooks?: string[];
  repos?: string[];
}

export async function removeCommand(
  ctx: MarshalContext,
  name: string | string[],
  opts: RemoveOptions,
): Promise<number> {
  const positionalRepos = Array.isArray(name) ? name : [name];
  return removeItemsCommand(ctx, {
    repos: [...positionalRepos, ...(opts.repos ?? [])],
    apps: opts.apps ?? [],
    hooks: opts.hooks ?? [],
  }, opts);
}

export async function removeItemsCommand(
  ctx: MarshalContext,
  targets: { repos?: string[]; apps?: string[]; hooks?: string[] },
  opts: RemoveOptions,
): Promise<number> {
  const loaded = await loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;

  const repos = unique(targets.repos ?? []);
  const apps = unique(targets.apps ?? []);
  const hooks = unique(targets.hooks ?? []);
  if (repos.length + apps.length + hooks.length === 0) {
    ctx.log.error("No apps, hooks, or repos provided.");
    return 2;
  }

  const missingRepos = repos.filter((name) => !manifest.repos.some((r) => r.name === name));
  const missingApps = apps.filter((id) => !manifest.apps.some((a) => a.id === id));
  const missingHooks = hooks.filter((name) => !manifest.hooks.some((h) => h.name === name));
  if (missingRepos.length + missingApps.length + missingHooks.length > 0) {
    if (missingRepos.length > 0) {
      ctx.log.error(`Repo(s) not in manifest: ${missingRepos.join(", ")}`);
    }
    if (missingApps.length > 0) {
      ctx.log.error(`App(s) not in manifest: ${missingApps.join(", ")}`);
    }
    if (missingHooks.length > 0) {
      ctx.log.error(`Hook(s) not in manifest: ${missingHooks.join(", ")}`);
    }
    return 1;
  }

  const summary = [
    repos.length > 0 ? `${repos.length} repo(s)` : "",
    apps.length > 0 ? `${apps.length} app(s)` : "",
    hooks.length > 0 ? `${hooks.length} hook(s)` : "",
  ].filter(Boolean).join(", ");
  ctx.log.info(`Will remove ${summary} from ${MANIFEST_FILENAME}.`);
  if (repos.length > 0 && opts.deleteFiles !== false) {
    ctx.log.info("Will delete cloned repo directories (use --keep-files to skip).");
  }
  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const repoSet = new Set(repos);
  const appSet = new Set(apps);
  const hookSet = new Set(hooks);
  const next = {
    ...manifest,
    apps: manifest.apps.filter((a) => !appSet.has(a.id)),
    repos: manifest.repos.filter((r) => !repoSet.has(r.name)),
    hooks: manifest.hooks.filter((h) => !hookSet.has(h.name)),
  };
  validateManifest(next);
  const path = join(bound, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);
  await commitAndPush(ctx, bound, `marshal: remove ${summary}`);

  if (repos.length > 0 && opts.deleteFiles !== false) {
    const { rmSync, existsSync } = await import("node:fs");
    const { resolveReposPath } = await import("../plan.js");
    const reposPath = resolveReposPath(manifest, ctx.homeDir);
    for (const repo of repos) {
      const target = join(reposPath, repo);
      if (existsSync(target)) {
        try {
          rmSync(target, { recursive: true, force: true });
          ctx.log.success(`Deleted ${target}`);
        } catch (err) {
          ctx.log.error(`Failed to delete ${target}: ${(err as Error).message}`);
          return 1;
        }
      }
    }
  }
  return 0;
}

async function loadBoundManifest(ctx: MarshalContext): Promise<{ bound: string; manifest: Manifest } | { code: number }> {
  let bound: string;
  try {
    bound = requireBinding(ctx.homeDir).dotfilesRepo;
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return { code: 1 };
    }
    throw err;
  }

  if (!await pullDotfilesRepo(ctx, bound)) {
    return { code: 1 };
  }

  try {
    return { bound, manifest: readManifest(bound) };
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return { code: 1 };
    }
    throw err;
  }
}

function parsePlatforms(platforms: string[] | undefined): Platform[] | { code: number; message: string } | undefined {
  if (!platforms || platforms.length === 0) {
    return undefined;
  }
  const invalid = platforms.filter((p): p is string => !SUPPORTED_PLATFORMS.includes(p as Platform));
  if (invalid.length > 0) {
    return {
      code: 1,
      message: `Unknown platform(s): ${invalid.join(", ")}. Expected one of: ${SUPPORTED_PLATFORMS.join(", ")}`,
    };
  }
  return platforms as Platform[];
}

function deriveName(url: string): string {
  const trimmed = url.replace(/\.git$/i, "").replace(/[/\\]+$/, "");
  const m = trimmed.match(/[/:]([^/:]+)$/);
  if (m) {
    return m[1];
  }
  return "tool";
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isValidHookCwd(cwd: string): boolean {
  if (isAbsolute(cwd)) {
    return false;
  }
  const segments = normalize(cwd)
    .split(/[\\/]+/)
    .filter(Boolean);
  return !segments.includes("..");
}

// Commit and push marshal.json changes in the bound dotfiles repo.
// Best-effort: logs warnings on failure but does not fail the command.
export async function commitAndPush(ctx: MarshalContext, dotfilesRepo: string, message: string): Promise<void> {
  try {
    await ctx.runner.exec(`git add ${MANIFEST_FILENAME}`, { cwd: dotfilesRepo, inherit: false });
    await ctx.runner.exec(`git commit -m "${message}"`, { cwd: dotfilesRepo, inherit: false });
  } catch (err) {
    const detail = err instanceof ProcessError ? err.result.stderr || err.result.stdout : (err as Error).message;
    ctx.log.warn(`Failed to commit ${MANIFEST_FILENAME}: ${detail.trim().split("\n")[0]}`);
    return;
  }
  try {
    await ctx.runner.exec(`git push`, { cwd: dotfilesRepo, inherit: false });
    ctx.log.success(`Committed and pushed ${MANIFEST_FILENAME}`);
  } catch (err) {
    const detail = err instanceof ProcessError ? err.result.stderr || err.result.stdout : (err as Error).message;
    ctx.log.warn(`Committed but failed to push: ${detail.trim().split("\n")[0]}`);
  }
}
