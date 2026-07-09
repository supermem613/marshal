import { MarshalContext } from "./context.js";
import { ProcessError } from "./runners/types.js";
import { readBinding } from "./binding.js";
import { readManifest } from "./manifest.js";
import { Vcs, DEFAULT_VCS } from "./vcs.js";

// The dotfiles repo's vcs is a marshal-scope declaration resolved the same way
// as self-update in `resolveMarshalVcs`: an explicit binding vcs wins, otherwise
// the bound dotfiles marshal.json top-level vcs applies, otherwise the default.
// The binding vcs is only written when `marshal bind --vcs` is passed, so a repo
// bound without that flag must still honor the vcs its own manifest declares
// rather than silently pulling with git. A raw git pull against an sd-powered
// repo trips sd's reference-transaction hook and aborts the sync.
// A broken manifest is not swallowed here: syncCommand reads the manifest right
// after the pull and reports the ManifestError loudly, so falling back to the
// default backend for backend selection alone is safe.
export function dotfilesVcs(ctx: MarshalContext): Vcs {
  const binding = readBinding(ctx.homeDir);
  if (!binding) {
    return DEFAULT_VCS;
  }
  if (binding.vcs) {
    return binding.vcs;
  }
  try {
    return readManifest(binding.dotfilesRepo).vcs ?? DEFAULT_VCS;
  } catch {
    return DEFAULT_VCS;
  }
}

export async function pullDotfilesRepo(ctx: MarshalContext, dotfilesRepo: string): Promise<boolean> {
  const backend = ctx.backendFor(dotfilesVcs(ctx));
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
