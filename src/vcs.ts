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

// soda's pull emits a JSON envelope. A reconcile that integrated nothing
// reports a record with status "up-to-date", the soda analogue of git's
// "Already up to date." If the envelope cannot be parsed we cannot confirm a
// no-change, so we report changed and let the caller reconcile rather than
// silently skipping a build.
function sodaReportedUpToDate(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { data?: Array<{ status?: string }> };
    const records = parsed.data ?? [];
    return records.length > 0 && records.every((r) => r.status === "up-to-date");
  } catch {
    return false;
  }
}

// soda (binary sd) is a changelist overlay, not a git-CLI drop-in. It clones
// and pulls with its own verbs, auto-opens changed files into the default
// changelist (no staging step), submits a changelist as a git commit, and
// publishes with push.
class SodaBackend implements VcsBackend {
  readonly vcs = "sd" as const;
  readonly bin = "sd";

  async clone(ctx: MarshalContext, url: string, dir: string): Promise<void> {
    await ctx.runner.exec(`sd clone ${url} "${dir}"`, { cwd: ctx.cwd, inherit: false });
  }

  async pull(ctx: MarshalContext, dir: string, opts: { inherit?: boolean } = {}): Promise<PullResult> {
    const result = await ctx.runner.exec("sd pull", {
      cwd: dir,
      inherit: opts.inherit ?? false,
    });
    return { changed: !sodaReportedUpToDate(result.stdout) };
  }

  // soda tracks the whole workspace, so there is no per-file staging. Submitting
  // the default changelist commits the pending manifest edit as one git commit.
  // The file argument is part of the shared VcsBackend contract but soda does
  // not need it.
  async commitFile(ctx: MarshalContext, dir: string, _file: string, message: string): Promise<void> {
    await ctx.runner.exec(`sd submit -d "${message}"`, { cwd: dir, inherit: false });
  }

  async push(ctx: MarshalContext, dir: string): Promise<void> {
    await ctx.runner.exec("sd push", { cwd: dir, inherit: false });
  }
}

const gitBackend = new GitBackend();
const sodaBackend = new SodaBackend();

// Resolve the backend for an explicitly declared vcs value.
export function resolveBackend(vcs: Vcs = DEFAULT_VCS): VcsBackend {
  switch (vcs) {
    case "git":
      return gitBackend;
    case "sd":
      return sodaBackend;
    default: {
      const exhaustive: never = vcs;
      throw new Error(`unknown vcs: ${String(exhaustive)}`);
    }
  }
}
