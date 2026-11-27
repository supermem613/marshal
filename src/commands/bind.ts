import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { MarshalContext } from "../context.js";
import { writeBinding, writeBindingReposPath, clearBinding, readBinding, requireBinding, BindingError } from "../binding.js";
import { resolvePath, expandHome, DEFAULT_REPOS_PATH } from "../paths.js";
import { isUrl } from "../url.js";
import { Vcs, VcsSchema, DEFAULT_VCS } from "../vcs.js";
import { syncCommand } from "./sync.js";

export interface BindOptions {
  path?: string;
  reposPath?: string;
  unsetReposPath?: boolean;
  show?: boolean;
  unset?: boolean;
  vcs?: string;       // validated against VcsSchema; controls the dotfiles backend
  sync?: boolean;     // commander coerces --no-sync → sync:false
  yes?: boolean;
}

// `marshal bind` handles three modes (it absorbs what would otherwise be a
// separate first-run / one-shot command):
//   marshal bind <url> [--path P] [--repos-path R] [--no-sync] [-y]
//     → clone the URL into P (default <reposPath|~/repos>/<repo-name>), bind, run sync (unless --no-sync).
//   marshal bind <path> [--repos-path R]
//     → bind to an existing local path. Does NOT auto-sync (predictable for re-bind).
//   marshal bind --show | --unset | --repos-path R | --unset-repos-path
//     → query, clear, or update machine-local binding fields.
export async function bindCommand(
  ctx: MarshalContext,
  target: string | undefined,
  opts: BindOptions,
): Promise<number> {
  if (opts.show) {
    const b = readBinding(ctx.homeDir);
    if (!b) {
      ctx.log.warn("No binding set.");
      return 1;
    }
    ctx.log.info(b.dotfilesRepo);
    if (b.reposPath) {
      ctx.log.info(`reposPath: ${b.reposPath}`);
    }
    return 0;
  }
  if (opts.unset) {
    const cleared = clearBinding(ctx.homeDir);
    if (cleared) {
      ctx.log.success("Binding cleared.");
    } else {
      ctx.log.warn("No binding to clear.");
    }
    return 0;
  }

  if (opts.reposPath !== undefined && opts.unsetReposPath) {
    ctx.log.error("bind: cannot combine --repos-path and --unset-repos-path.");
    return 2;
  }
  if (opts.reposPath !== undefined && opts.reposPath.trim().length === 0) {
    ctx.log.error("bind: --repos-path must be a non-empty path.");
    return 2;
  }

  const reposPathUpdate: string | null | undefined = opts.unsetReposPath
    ? null
    : opts.reposPath !== undefined
      ? resolvePath(opts.reposPath, ctx.cwd, ctx.homeDir)
      : undefined;

  let vcs: Vcs | undefined;
  if (opts.vcs !== undefined) {
    const parsed = VcsSchema.safeParse(opts.vcs);
    if (!parsed.success) {
      ctx.log.error(`bind: invalid --vcs "${opts.vcs}". Expected one of: git, soda.`);
      return 2;
    }
    vcs = parsed.data;
  }

  if (!target) {
    if (reposPathUpdate !== undefined) {
      try {
        if (vcs !== undefined) {
          const existing = requireBinding(ctx.homeDir);
          writeBinding(existing.dotfilesRepo, ctx.homeDir, vcs, reposPathUpdate);
        } else {
          writeBindingReposPath(reposPathUpdate, ctx.homeDir);
        }
      } catch (err) {
        if (err instanceof BindingError) {
          ctx.log.error(err.message);
          return 1;
        }
        throw err;
      }
      if (reposPathUpdate === null) {
        ctx.log.success("Cleared per-machine reposPath override.");
      } else {
        ctx.log.success(`Repos path set to ${reposPathUpdate}`);
      }
      return 0;
    }
    ctx.log.error("bind: missing argument. Provide a URL or path, or use --show/--unset/--repos-path/--unset-repos-path.");
    return 2;
  }

  if (isUrl(target)) {
    return await bindUrl(ctx, target, opts, vcs, reposPathUpdate);
  }
  return await bindPath(ctx, target, vcs, reposPathUpdate);
}

async function bindUrl(
  ctx: MarshalContext,
  url: string,
  opts: BindOptions,
  vcs?: Vcs,
  reposPath?: string | null,
): Promise<number> {
  const defaultParent = typeof reposPath === "string"
    ? reposPath
    : expandHome(DEFAULT_REPOS_PATH, ctx.homeDir);
  const targetPath = opts.path
    ? resolvePath(expandHome(opts.path, ctx.homeDir), ctx.homeDir, ctx.homeDir)
    : resolvePath(join(defaultParent, deriveRepoName(url)), ctx.homeDir, ctx.homeDir);

  const backend = ctx.backendFor(vcs ?? DEFAULT_VCS);
  if (existsSync(targetPath)) {
    ctx.log.info(`Path already exists; skipping clone: ${targetPath}`);
  } else {
    ctx.log.info(`→ ${backend.bin} clone ${url} ${targetPath}`);
    try {
      await backend.clone(ctx, url, targetPath);
    } catch (err) {
      ctx.log.error(`Clone failed: ${(err as Error).message.split("\n")[0]}`);
      return 1;
    }
  }

  try {
    writeBinding(targetPath, ctx.homeDir, vcs, reposPath);
  } catch (err) {
    ctx.log.error((err as Error).message);
    return 1;
  }
  ctx.log.success(`Bound to ${targetPath}`);

  if (opts.sync === false) {
    ctx.log.info("Skipping sync (--no-sync).");
    return 0;
  }
  return await syncCommand(ctx, { yes: opts.yes ?? false, repos: [] });
}

async function bindPath(
  ctx: MarshalContext,
  path: string,
  vcs?: Vcs,
  reposPath?: string | null,
): Promise<number> {
  const resolved = resolvePath(path, ctx.cwd, ctx.homeDir);
  try {
    writeBinding(resolved, ctx.homeDir, vcs, reposPath);
  } catch (err) {
    ctx.log.error((err as Error).message);
    return 1;
  }
  ctx.log.success(`Bound to ${resolved}`);
  ctx.log.dim(`Run \`marshal sync\` to provision.`);
  return 0;
}

// Extract a sensible default folder name from a clonable URL.
//   https://github.com/me/dotfiles.git → "dotfiles"
//   git@github.com:me/dotfiles.git → "dotfiles"
function deriveRepoName(url: string): string {
  const trimmed = url.replace(/\.git$/i, "").replace(/[/\\]+$/, "");
  // Last path-like segment after / or :
  const m = trimmed.match(/[/:]([^/:]+)$/);
  if (m) {
    return m[1];
  }
  return basename(trimmed) || "dotfiles";
}

export const _internal = { deriveRepoName };
// keep join referenced (used implicitly via paths) so eslint stays quiet
void join;
