import { BindingError, readBinding, requireBinding, writeBindingProfile } from "../binding.js";
import { MarshalContext } from "../context.js";
import { ManifestError, readManifest } from "../manifest.js";
import { ProfileError, validateProfileName } from "../profile.js";
import { pullDotfilesRepo } from "../dotfiles-git.js";

export type ProfileAction = "list" | "get" | "set" | "clear";

export async function profileCommand(
  ctx: MarshalContext,
  action: ProfileAction | undefined,
  name?: string,
): Promise<number> {
  const resolvedAction = action ?? "get";
  if (resolvedAction === "get") {
    return profileGet(ctx);
  }
  if (resolvedAction === "list") {
    return profileList(ctx);
  }
  if (resolvedAction === "set") {
    if (!name) {
      ctx.log.error("profile set: missing profile name");
      return 2;
    }
    return profileSet(ctx, name);
  }
  if (resolvedAction === "clear") {
    return profileClear(ctx);
  }
  ctx.log.error(`Unknown profile action: ${resolvedAction}`);
  return 2;
}

async function profileGet(ctx: MarshalContext): Promise<number> {
  const binding = readBinding(ctx.homeDir);
  if (!binding) {
    ctx.log.error("No binding found. Run `marshal bind <dotfiles-url-or-path>` first.");
    return 1;
  }
  ctx.log.info(binding.profile ? binding.profile : "(none)");
  return 0;
}

async function profileList(ctx: MarshalContext): Promise<number> {
  const loaded = await loadBindingAndManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { binding, manifest } = loaded;
  if (manifest.profiles.length === 0) {
    ctx.log.warn("No profiles declared in marshal.json.");
    return 0;
  }
  for (const profile of manifest.profiles) {
    const marker = binding.profile === profile ? "*" : " ";
    ctx.log.info(`${marker} ${profile}`);
  }
  return 0;
}

async function profileSet(ctx: MarshalContext, profile: string): Promise<number> {
  const loaded = await loadBindingAndManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  try {
    validateProfileName(loaded.manifest, profile, "profile set");
    writeBindingProfile(profile, ctx.homeDir);
  } catch (err) {
    if (err instanceof ProfileError || err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
  ctx.log.success(`Profile set to ${profile}`);
  return 0;
}

async function profileClear(ctx: MarshalContext): Promise<number> {
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
  if (!await pullDotfilesRepo(ctx, binding.dotfilesRepo)) {
    return 1;
  }
  try {
    writeBindingProfile(null, ctx.homeDir);
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
  ctx.log.success("Profile cleared.");
  return 0;
}

async function loadBindingAndManifest(ctx: MarshalContext): Promise<
  | { binding: ReturnType<typeof requireBinding>; manifest: ReturnType<typeof readManifest> }
  | { code: number }
> {
  let binding;
  try {
    binding = requireBinding(ctx.homeDir);
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return { code: 1 };
    }
    throw err;
  }
  if (!await pullDotfilesRepo(ctx, binding.dotfilesRepo)) {
    return { code: 1 };
  }
  try {
    return { binding, manifest: readManifest(binding.dotfilesRepo) };
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return { code: 1 };
    }
    throw err;
  }
}
