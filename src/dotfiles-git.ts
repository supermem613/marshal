import { MarshalContext } from "./context.js";
import { ProcessError } from "./runners/types.js";
import { readBinding } from "./binding.js";
import { readManifest, ManifestError } from "./manifest.js";
import { Vcs, DEFAULT_VCS } from "./vcs.js";

// The dotfiles repo's vcs is a marshal-scope declaration resolved the same way
// as self-update in `resolveMarshalVcs`: an explicit binding vcs wins, otherwise
// the bound dotfiles marshal.json top-level vcs applies, otherwise the default.
// The binding vcs is only written when `marshal bind --vcs` is passed, so a repo
// bound without that flag must still honor the vcs its own manifest declares
// rather than silently pulling with git. A raw git pull against an sd-powered
// repo trips sd's reference-transaction hook and aborts the sync.
// A broken manifest must not degrade to the default backend: the fallback would
// pick git for an sd repo and the resulting pull failure would mask the real
// cause. ManifestError therefore propagates to the caller, which reports it.
export function dotfilesVcs(ctx: MarshalContext): Vcs {
  const binding = readBinding(ctx.homeDir);
  if (!binding) {
    return DEFAULT_VCS;
  }
  if (binding.vcs) {
    return binding.vcs;
  }
  return readManifest(binding.dotfilesRepo).vcs ?? DEFAULT_VCS;
}

export async function pullDotfilesRepo(ctx: MarshalContext, dotfilesRepo: string): Promise<boolean> {
  let backend;
  try {
    backend = ctx.backendFor(dotfilesVcs(ctx));
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return false;
    }
    throw err;
  }
  ctx.log.info(`→ (${dotfilesRepo}) ${backend.bin} pull`);
  try {
    await backend.pull(ctx, dotfilesRepo);
    return true;
  } catch (err) {
    if (err instanceof ProcessError) {
      ctx.log.error(`dotfiles pull failed: ${err.result.stderr || err.result.stdout}`.trim());
      return false;
    }
    throw err;
  }
}
