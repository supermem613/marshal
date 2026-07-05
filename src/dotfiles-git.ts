import { MarshalContext } from "./context.js";
import { ProcessError } from "./runners/types.js";
import { readBinding } from "./binding.js";
import { Vcs, DEFAULT_VCS } from "./vcs.js";

// The dotfiles repo's vcs is declared marshal-level in the ~/.marshal.json
// binding. Before marshal is bound (for example during init) no vcs is
// declared, so the documented default applies.
export function dotfilesVcs(ctx: MarshalContext): Vcs {
  return readBinding(ctx.homeDir)?.vcs ?? DEFAULT_VCS;
}

export async function pullDotfilesRepo(ctx: MarshalContext, dotfilesRepo: string): Promise<boolean> {
  ctx.log.info(`→ (${dotfilesRepo}) git pull --ff-only`);
  try {
    await ctx.backendFor(dotfilesVcs(ctx)).pull(ctx, dotfilesRepo);
    return true;
  } catch (err) {
    if (err instanceof ProcessError) {
      ctx.log.error(`dotfiles pull failed: ${err.result.stderr || err.result.stdout}`.trim());
      return false;
    }
    throw err;
  }
}
