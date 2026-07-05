import { existsSync } from "node:fs";
import { MarshalContext } from "../context.js";
import { ProcessError } from "../runners/types.js";
import { readBinding } from "../binding.js";
import { readManifest } from "../manifest.js";
import { Vcs, DEFAULT_VCS } from "../vcs.js";

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
  const backend = ctx.backendFor(resolveMarshalVcs(ctx));
  ctx.log.info(`→ ${backend.bin} pull`);
  let pullChanged = true;
  try {
    const pull = await backend.pull(ctx, ctx.marshalSourceDir, { inherit: true });
    pullChanged = pull.changed;
  } catch (err) {
    const msg = err instanceof ProcessError ? err.message.split("\n")[0] : (err as Error).message;
    ctx.log.error(`Failed: ${backend.bin} pull — ${msg}`);
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

// Marshal-level vcs is declared in the bound dotfiles marshal.json. When marshal
// is not bound to any dotfiles repo, no vcs is declared, so the documented default
// applies. A bound-but-invalid manifest surfaces loudly rather than being masked.
function resolveMarshalVcs(ctx: MarshalContext): Vcs {
  const binding = readBinding(ctx.homeDir);
  if (!binding) {
    return DEFAULT_VCS;
  }
  return readManifest(binding.dotfilesRepo).vcs ?? DEFAULT_VCS;
}
