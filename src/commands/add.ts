import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
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

export interface AddOptions {
  install_cmd?: string;
  update_cmd?: string;
  install_cwd?: string;
  platforms?: string[];
  yes?: boolean;
  sync?: boolean;
  noSync?: boolean;
}

export async function addCommand(
  ctx: MarshalContext,
  url: string,
  name: string | undefined,
  opts: AddOptions,
): Promise<number> {
  const loaded = loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;

  const resolvedName = name ?? deriveName(url);
  if (manifest.repos.some((r) => r.name === resolvedName)) {
    ctx.log.error(`Repo "${resolvedName}" already in manifest.`);
    return 1;
  }
  const platforms = parsePlatforms(opts.platforms);
  if (platforms && "code" in platforms) {
    ctx.log.error(platforms.message);
    return platforms.code;
  }
  const installCmd = opts.install_cmd ?? "npm install && npm run build && npm link";
  const newRepo: Repo = {
    name: resolvedName,
    url,
    install_cmd: installCmd,
    ...(opts.install_cwd ? { install_cwd: opts.install_cwd } : {}),
    ...(opts.update_cmd ? { update_cmd: opts.update_cmd } : {}),
    ...(platforms && platforms.length > 0
      ? { platforms }
      : {}),
  };
  const next: Manifest = {
    ...manifest,
    repos: [...manifest.repos, newRepo],
  };
  validateManifest(next);

  ctx.log.info(`Will add repo to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newRepo, null, 2));

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

  if (!opts.sync) {
    ctx.log.info("Run `marshal sync` to apply.");
    return 0;
  }
  return await syncCommand(ctx, { yes: opts.yes ?? false, repos: [resolvedName] });
}

export interface AddAppOptions {
  platforms?: string[];
  yes?: boolean;
  sync?: boolean;
}

export async function addAppCommand(
  ctx: MarshalContext,
  id: string,
  opts: AddAppOptions,
): Promise<number> {
  const loaded = loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;
  if (manifest.apps.some((a) => a.id === id)) {
    ctx.log.error(`App "${id}" already in manifest.`);
    return 1;
  }
  const platforms = parsePlatforms(opts.platforms);
  if (platforms && "code" in platforms) {
    ctx.log.error(platforms.message);
    return platforms.code;
  }
  const newApp: App = {
    id,
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
  };
  const next: Manifest = {
    ...manifest,
    apps: [...manifest.apps, newApp],
  };
  validateManifest(next);

  ctx.log.info(`Will add app to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newApp, null, 2));

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
  interactive?: boolean;
  yes?: boolean;
  sync?: boolean;
}

export async function addHookCommand(
  ctx: MarshalContext,
  name: string,
  opts: AddHookOptions,
): Promise<number> {
  const loaded = loadBoundManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { bound, manifest } = loaded;
  if (manifest.hooks.some((h) => h.name === name)) {
    ctx.log.error(`Hook "${name}" already in manifest.`);
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
  const newHook: Hook = {
    name,
    stage: "post-repos",
    cmd: opts.cmd,
    interactive: opts.interactive ?? false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
  };
  const next: Manifest = {
    ...manifest,
    hooks: [...manifest.hooks, newHook],
  };
  validateManifest(next);

  ctx.log.info(`Will add hook to ${MANIFEST_FILENAME}:`);
  ctx.log.info(JSON.stringify(newHook, null, 2));

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
}

export async function removeCommand(
  ctx: MarshalContext,
  name: string,
  opts: RemoveOptions,
): Promise<number> {
  let bound: string;
  try {
    bound = requireBinding(ctx.homeDir).dotfilesRepo;
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  let manifest;
  try {
    manifest = readManifest(bound);
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  const idx = manifest.repos.findIndex((r) => r.name === name);
  if (idx === -1) {
    ctx.log.error(`Repo "${name}" not in manifest.`);
    return 1;
  }

  ctx.log.info(`Will remove "${name}" from ${MANIFEST_FILENAME}.`);
  if (opts.deleteFiles !== false) {
    ctx.log.info(`Will delete cloned repo directory (use --keep-files to skip).`);
  }
  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const next = { ...manifest, repos: manifest.repos.filter((r) => r.name !== name) };
  const path = join(bound, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);

  if (opts.deleteFiles !== false) {
    const { rmSync, existsSync } = await import("node:fs");
    const { resolveReposPath } = await import("../plan.js");
    const reposPath = resolveReposPath(manifest, ctx.homeDir);
    const target = join(reposPath, name);
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
  return 0;
}

function loadBoundManifest(ctx: MarshalContext): { bound: string; manifest: Manifest } | { code: number } {
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

function isValidHookCwd(cwd: string): boolean {
  if (isAbsolute(cwd)) {
    return false;
  }
  const segments = normalize(cwd)
    .split(/[\\/]+/)
    .filter(Boolean);
  return !segments.includes("..");
}

void readFileSync;
