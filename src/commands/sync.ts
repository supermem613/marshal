import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
import { readManifest, ManifestError } from "../manifest.js";
import { buildPlan, unknownRepoNames } from "../plan.js";
import { renderPlan, renderResults } from "../render.js";
import { applyPlan } from "../apply.js";
import { ProcessError } from "../runners/types.js";
import { ProfileError, requireProfileForScopedItems, resolveActiveProfile } from "../profile.js";

export interface SyncOptions {
  yes?: boolean;
  // Optional list of repo names to sync. Empty = all applicable.
  repos?: string[];
  // Run manifest hooks even when syncing a subset of repos.
  hooks?: boolean;
  profile?: string;
}

export async function syncCommand(ctx: MarshalContext, opts: SyncOptions): Promise<number> {
  let binding;
  try {
    binding = requireBinding(ctx.homeDir);
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  // Pull latest dotfiles before reading manifest.
  const dotfiles = binding.dotfilesRepo;
  ctx.log.info(`→ (${dotfiles}) git pull --ff-only`);
  try {
    await ctx.runner.exec("git pull --ff-only", { cwd: dotfiles, inherit: false });
  } catch (err) {
    if (err instanceof ProcessError) {
      ctx.log.error(`dotfiles pull failed: ${err.result.stderr || err.result.stdout}`.trim());
      return 1;
    }
    throw err;
  }

  let manifest;
  try {
    manifest = readManifest(dotfiles);
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  let activeProfile;
  try {
    activeProfile = resolveActiveProfile(manifest, binding, opts.profile);
    requireProfileForScopedItems(manifest, activeProfile);
  } catch (err) {
    if (err instanceof ProfileError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  const requested = opts.repos ?? [];
  if (requested.length > 0) {
    const unknown = unknownRepoNames(manifest, ctx.platform, requested, activeProfile.profile);
    if (unknown.length > 0) {
      ctx.log.error(`Unknown repo(s) for ${ctx.platform}/${activeProfile.profile ?? "no-profile"}: ${unknown.join(", ")}`);
      return 1;
    }
  }

  const plan = buildPlan(manifest, {
    homeDir: ctx.homeDir,
    dotfilesRepo: dotfiles,
    platform: ctx.platform,
    repoFilter: requested,
    includeHooks: requested.length === 0 || opts.hooks === true,
    activeProfile,
  });

  renderPlan(plan, ctx.log);

  if (plan.apps.length + plan.repos.length === 0) {
    return 0;
  }

  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Proceed?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return 0;
    }
  }

  const results = await applyPlan(ctx, plan);
  renderResults(results, ctx.log);
  const failed = results.filter((r) => !r.ok).length;
  return failed > 0 ? 1 : 0;
}
