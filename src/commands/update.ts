import { existsSync } from "node:fs";
import { MarshalContext } from "../context.js";
import { gitPullMadeNoChanges } from "../command-state.js";
import { ProcessError } from "../runners/types.js";

// `marshal update` — self-update. Runs git pull in marshal's own source
// directory, then refreshes dependencies + build output only when new changes
// land. Same shape as `kash update`, `rotunda update`, etc. The npm-link
// symlink persists, so no relink.
export async function updateCommand(ctx: MarshalContext): Promise<number> {
  if (!existsSync(ctx.marshalSourceDir)) {
    ctx.log.error(`Marshal source dir not found: ${ctx.marshalSourceDir}`);
    return 1;
  }
  ctx.log.info(`Self-update in ${ctx.marshalSourceDir}`);
  ctx.log.info("→ git pull --ff-only");
  let pullChanged = true;
  try {
    const pull = await ctx.runner.exec("git pull --ff-only", { cwd: ctx.marshalSourceDir, inherit: true });
    pullChanged = !gitPullMadeNoChanges(pull);
  } catch (err) {
    const msg = err instanceof ProcessError ? err.message.split("\n")[0] : (err as Error).message;
    ctx.log.error(`Failed: git pull --ff-only — ${msg}`);
    return 1;
  }
  if (!pullChanged) {
    ctx.log.success("marshal already up to date.");
    return 0;
  }
  for (const step of ["npm install", "npm run build"]) {
    ctx.log.info(`→ ${step}`);
    try {
      await ctx.runner.exec(step, { cwd: ctx.marshalSourceDir, inherit: true });
    } catch (err) {
      const msg = err instanceof ProcessError ? err.message.split("\n")[0] : (err as Error).message;
      ctx.log.error(`Failed: ${step} — ${msg}`);
      return 1;
    }
  }
  ctx.log.success("marshal updated.");
  return 0;
}
