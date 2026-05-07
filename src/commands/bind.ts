import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { MarshalContext } from "../context.js";
import { writeBinding, clearBinding, readBinding } from "../binding.js";
import { resolvePath, expandHome, DEFAULT_REPOS_PATH } from "../paths.js";
import { isUrl } from "../url.js";
import { syncCommand } from "./sync.js";

export interface BindOptions {
  path?: string;
  show?: boolean;
  unset?: boolean;
  sync?: boolean;     // commander coerces --no-sync → sync:false
  yes?: boolean;
}

// `marshal bind` handles three modes (it absorbs what would otherwise be a
// separate first-run / one-shot command):
//   marshal bind <url> [--path P] [--no-sync] [-y]
//     → clone the URL into P (default ~/repos/dotfiles), bind, run sync (unless --no-sync).
//   marshal bind <path>
//     → bind to an existing local path. Does NOT auto-sync (predictable for re-bind).
//   marshal bind --show | --unset
//     → query / clear the binding.
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
  if (!target) {
    ctx.log.error("bind: missing argument. Provide a URL or path, or use --show/--unset.");
    return 2;
  }

  if (isUrl(target)) {
    return await bindUrl(ctx, target, opts);
  }
  return await bindPath(ctx, target);
}

async function bindUrl(ctx: MarshalContext, url: string, opts: BindOptions): Promise<number> {
  const targetPath = resolvePath(
    expandHome(opts.path ?? DEFAULT_REPOS_PATH + "/" + deriveRepoName(url), ctx.homeDir),
    ctx.homeDir,
    ctx.homeDir,
  );

  if (existsSync(targetPath)) {
    ctx.log.info(`Path already exists; skipping clone: ${targetPath}`);
  } else {
    ctx.log.info(`→ git clone ${url} ${targetPath}`);
    try {
      await ctx.runner.exec(`git clone ${url} "${targetPath}"`, { cwd: ctx.cwd, inherit: false });
    } catch (err) {
      ctx.log.error(`Clone failed: ${(err as Error).message.split("\n")[0]}`);
      return 1;
    }
  }

  try {
    writeBinding(targetPath, ctx.homeDir);
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

async function bindPath(ctx: MarshalContext, path: string): Promise<number> {
  const resolved = resolvePath(path, ctx.cwd, ctx.homeDir);
  try {
    writeBinding(resolved, ctx.homeDir);
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
