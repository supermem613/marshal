import type { MarshalContext } from "./context.js";
import { z } from "zod";

// Every VCS-touching operation in marshal routes through a VcsBackend. The VCS
// for each context is an explicitly declared choice, never auto-detected.
// soda (binary sd) is not a git-CLI drop-in. It is a changelist overlay whose
// verbs diverge from git (submit instead of commit, no add, JSON output, no
// --ff-only). Each backend therefore owns its own command grammar and its own
// no-change interpretation.

export type Vcs = "git" | "sd";

export const VCS_VALUES = ["git", "sd"] as const;

// Zod enum for validating a declared vcs value in manifest and binding schemas.
export const VcsSchema = z.enum(VCS_VALUES);

export const DEFAULT_VCS: Vcs = "git";

export interface PullResult {
  // True when the pull advanced the working copy. Each backend interprets its
  // own no-change signal.
  changed: boolean;
}

export interface VcsBackend {
  readonly vcs: Vcs;
  // Executable this backend drives. doctor derives which binaries to verify
  // from the declared vcs values.
  readonly bin: string;
  clone(ctx: MarshalContext, url: string, dir: string): Promise<void>;
  pull(ctx: MarshalContext, dir: string, opts?: { inherit?: boolean }): Promise<PullResult>;
  commitFile(ctx: MarshalContext, dir: string, file: string, message: string): Promise<void>;
  push(ctx: MarshalContext, dir: string): Promise<void>;
}

function gitPullMadeNoChanges(output: string): boolean {
  return /already up[- ]to[- ]date\.?/i.test(output);
}

class GitBackend implements VcsBackend {
  readonly vcs = "git" as const;
  readonly bin = "git";

  async clone(ctx: MarshalContext, url: string, dir: string): Promise<void> {
    await ctx.runner.exec(`git clone ${url} "${dir}"`, { cwd: ctx.cwd, inherit: false });
  }

  async pull(ctx: MarshalContext, dir: string, opts: { inherit?: boolean } = {}): Promise<PullResult> {
    const result = await ctx.runner.exec("git pull --ff-only", {
      cwd: dir,
      inherit: opts.inherit ?? false,
    });
    return { changed: !gitPullMadeNoChanges(`${result.stdout}\n${result.stderr}`) };
  }

  async commitFile(ctx: MarshalContext, dir: string, file: string, message: string): Promise<void> {
    await ctx.runner.exec(`git add ${file}`, { cwd: dir, inherit: false });
    await ctx.runner.exec(`git commit -m "${message}"`, { cwd: dir, inherit: false });
  }

  async push(ctx: MarshalContext, dir: string): Promise<void> {
    await ctx.runner.exec("git push", { cwd: dir, inherit: false });
  }
}

const gitBackend = new GitBackend();

// Resolve the backend for an explicitly declared vcs value. SodaBackend is
// registered in a later phase; until then "sd" fails loudly rather than
// silently pretending git grammar works.
export function resolveBackend(vcs: Vcs = DEFAULT_VCS): VcsBackend {
  switch (vcs) {
    case "git":
      return gitBackend;
    case "sd":
      throw new Error(`vcs "sd" is not yet supported`);
    default: {
      const exhaustive: never = vcs;
      throw new Error(`unknown vcs: ${String(exhaustive)}`);
    }
  }
}
