import { MarshalContext } from "../context.js";
import { requireBinding, BindingError, writeBindingProfile, readBinding } from "../binding.js";
import { readManifest, ManifestError } from "../manifest.js";
import { buildPlan } from "../plan.js";
import { ProfileError, resolveActiveProfile, validateProfileName } from "../profile.js";
import { pullDotfilesRepo } from "../dotfiles-git.js";
import { syncCommand } from "./sync.js";

export interface SetupOptions {
  profile?: string;
  yes?: boolean;
  // commander maps --no-sync to sync:false. Default (undefined) runs sync.
  sync?: boolean;
  // Report the resolved profile and per-step satisfaction, then exit.
  status?: boolean;
  // Re-select the machine profile even if one is already bound.
  force?: boolean;
}

// `marshal setup` is the one-time machine bootstrap. It picks the machine
// profile interactively, then runs sync with the manifest's one-time setup
// steps (authentications) included before apps and repos.
export async function setupCommand(ctx: MarshalContext, opts: SetupOptions): Promise<number> {
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

  const dotfiles = binding.dotfilesRepo;
  if (!await pullDotfilesRepo(ctx, dotfiles)) {
    return 1;
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

  if (opts.status) {
    return await reportStatus(ctx, manifest, dotfiles);
  }

  const resolvedProfile = await resolveSetupProfile(ctx, manifest, binding.profile ?? null, opts);
  if (typeof resolvedProfile === "number") {
    return resolvedProfile;
  }

  if (opts.sync === false) {
    ctx.log.info("Profile recorded. Skipping sync (--no-sync). Run `marshal setup` or `marshal sync` to provision.");
    return 0;
  }

  // Delegate provisioning to sync with setup steps included. The freshly
  // written profile is read back from the binding by syncCommand.
  return await syncCommand(ctx, { yes: opts.yes ?? false, includeSetup: true });
}

async function resolveSetupProfile(
  ctx: MarshalContext,
  manifest: ReturnType<typeof readManifest>,
  currentProfile: string | null,
  opts: SetupOptions,
): Promise<string | null | number> {
  if (opts.profile !== undefined) {
    try {
      validateProfileName(manifest, opts.profile, "--profile");
    } catch (err) {
      if (err instanceof ProfileError) {
        ctx.log.error(err.message);
        return 1;
      }
      throw err;
    }
    writeBindingProfile(opts.profile, ctx.homeDir);
    ctx.log.success(`Profile set to ${opts.profile}`);
    return opts.profile;
  }

  if (manifest.profiles.length === 0) {
    ctx.log.info("No profiles declared in marshal.json. Continuing without a profile.");
    return null;
  }

  if (currentProfile && !opts.force) {
    ctx.log.info(`Using bound profile "${currentProfile}". Pass --force to choose a different one.`);
    return currentProfile;
  }

  try {
    const chosen = await ctx.prompt.select("Select machine profile:", manifest.profiles);
    writeBindingProfile(chosen, ctx.homeDir);
    ctx.log.success(`Profile set to ${chosen}`);
    return chosen;
  } catch (err) {
    ctx.log.error((err as Error).message);
    ctx.log.error(`Pass \`--profile <name>\` to choose one of: ${manifest.profiles.join(", ")}`);
    return 1;
  }
}

async function reportStatus(
  ctx: MarshalContext,
  manifest: ReturnType<typeof readManifest>,
  dotfiles: string,
): Promise<number> {
  const binding = readBinding(ctx.homeDir);
  let activeProfile;
  try {
    activeProfile = resolveActiveProfile(manifest, binding!);
  } catch (err) {
    if (err instanceof ProfileError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
  ctx.log.info(`Profile: ${activeProfile.profile ?? "(none)"}`);

  const plan = buildPlan(manifest, {
    homeDir: ctx.homeDir,
    dotfilesRepo: dotfiles,
    platform: ctx.platform,
    includeSetup: true,
    activeProfile,
  });

  if (plan.setup.length === 0) {
    ctx.log.info("No setup steps apply to this machine.");
    return 0;
  }

  for (const step of plan.setup) {
    if (!step.checkCmd) {
      ctx.log.info(`? ${step.name} — no check_cmd (runs every setup)`);
      continue;
    }
    try {
      const check = await ctx.runner.exec(step.checkCmd, {
        cwd: step.cwd,
        inherit: false,
        allowNonZero: true,
      });
      if (check.code === 0) {
        ctx.log.success(`${step.name} — satisfied`);
      } else {
        ctx.log.warn(`${step.name} — pending`);
      }
    } catch (err) {
      ctx.log.warn(`${step.name} — pending (${(err as Error).message.split("\n")[0]})`);
    }
  }
  return 0;
}
