import { Binding } from "./binding.js";
import { Manifest } from "./manifest.js";

export type ProfileSource = "binding" | "override" | "none";

export interface ActiveProfile {
  profile: string | null;
  source: ProfileSource;
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export function hasProfileScopedItems(manifest: Manifest): boolean {
  return manifest.apps.some((a) => hasProfiles(a.profiles))
    || manifest.repos.some((r) => hasProfiles(r.profiles))
    || manifest.hooks.some((h) => hasProfiles(h.profiles));
}

export function resolveActiveProfile(
  manifest: Manifest,
  binding: Binding,
  override?: string,
): ActiveProfile {
  if (override !== undefined) {
    validateProfileName(manifest, override, "--profile");
    return { profile: override, source: "override" };
  }
  if (binding.profile) {
    validateProfileName(manifest, binding.profile, "~/.marshal.json");
    return { profile: binding.profile, source: "binding" };
  }
  return { profile: null, source: "none" };
}

export function requireProfileForScopedItems(manifest: Manifest, active: ActiveProfile): void {
  if (active.profile || !hasProfileScopedItems(manifest)) {
    return;
  }
  const declared = manifest.profiles.length > 0
    ? manifest.profiles.join(", ")
    : "(none declared)";
  throw new ProfileError(
    `Profile-scoped items exist, but no active profile is set. Run \`marshal profile set <name>\`. Declared profiles: ${declared}`,
  );
}

export function validateProfileName(manifest: Manifest, profile: string, source: string): void {
  if (manifest.profiles.includes(profile)) {
    return;
  }
  const declared = manifest.profiles.length > 0
    ? manifest.profiles.join(", ")
    : "(none declared)";
  throw new ProfileError(`Unknown profile "${profile}" from ${source}. Declared profiles: ${declared}`);
}

export function profileApplies(profiles: string[] | undefined, activeProfile: string | null | undefined): boolean {
  if (!hasProfiles(profiles)) {
    return true;
  }
  return activeProfile !== null && activeProfile !== undefined && profiles.includes(activeProfile);
}

export function formatActiveProfile(active: ActiveProfile): string {
  if (!active.profile) {
    return "none";
  }
  return `${active.profile} (${active.source})`;
}

function hasProfiles(profiles: string[] | undefined): profiles is string[] {
  return Array.isArray(profiles) && profiles.length > 0;
}
