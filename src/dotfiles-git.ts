import { MarshalContext } from "./context.js";
import { ProcessError } from "./runners/types.js";

export async function pullDotfilesRepo(ctx: MarshalContext, dotfilesRepo: string): Promise<boolean> {
  ctx.log.info(`→ (${dotfilesRepo}) git pull --ff-only`);
  try {
    await ctx.runner.exec("git pull --ff-only", { cwd: dotfilesRepo, inherit: false });
    return true;
  } catch (err) {
    if (err instanceof ProcessError) {
      ctx.log.error(`dotfiles pull failed: ${err.result.stderr || err.result.stdout}`.trim());
      return false;
    }
    throw err;
  }
}
