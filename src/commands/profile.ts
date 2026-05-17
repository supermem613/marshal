import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BindingError, readBinding, requireBinding, writeBindingProfile } from "../binding.js";
import { MarshalContext } from "../context.js";
import { App, Hook, MANIFEST_FILENAME, Manifest, ManifestError, readManifest, Repo, validateManifest } from "../manifest.js";
import { ProfileError, validateProfileName } from "../profile.js";
import { pullDotfilesRepo } from "../dotfiles-git.js";
import { commitAndPush } from "./add.js";

export type ProfileAction = "list" | "get" | "set" | "clear" | "add" | "remove" | "scope" | "unscope";
export type ProfileScopeKind = "app" | "apps" | "repo" | "repos" | "hook" | "hooks";

export interface ProfileOptions {
  yes?: boolean;
}

interface ManifestWriteResult {
  code: number;
  applied: boolean;
}

export async function profileCommand(
  ctx: MarshalContext,
  action: ProfileAction | undefined,
  name?: string,
  itemName?: string | string[],
  profileName?: string,
  opts: ProfileOptions = {},
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
  if (resolvedAction === "add") {
    if (!name) {
      ctx.log.error("profile add: missing profile name");
      return 2;
    }
    return profileAdd(ctx, name, opts);
  }
  if (resolvedAction === "remove") {
    if (!name) {
      ctx.log.error("profile remove: missing profile name");
      return 2;
    }
    return profileRemove(ctx, name, opts);
  }
  if (resolvedAction === "scope" || resolvedAction === "unscope") {
    if (!name || !itemName || !profileName) {
      ctx.log.error(`profile ${resolvedAction}: expected <app|repo|hook> <name> <profile>`);
      return 2;
    }
    return profileScope(ctx, resolvedAction, name, Array.isArray(itemName) ? itemName : [itemName], profileName, opts);
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

async function profileAdd(ctx: MarshalContext, profile: string, opts: ProfileOptions): Promise<number> {
  const loaded = await loadBindingAndManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { binding, manifest } = loaded;
  if (manifest.profiles.includes(profile)) {
    ctx.log.info(`Profile "${profile}" already declared.`);
    return 0;
  }
  const next = validateProfileManifest(ctx, {
    ...manifest,
    profiles: [...manifest.profiles, profile],
  });
  if (!next) {
    return 1;
  }
  const result = await writeManifestChange(ctx, binding.dotfilesRepo, next, opts, `Will add profile "${profile}" to ${MANIFEST_FILENAME}.`, `marshal: add profile ${profile}`);
  return result.code;
}

async function profileRemove(ctx: MarshalContext, profile: string, opts: ProfileOptions): Promise<number> {
  const loaded = await loadBindingAndManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { binding, manifest } = loaded;
  if (!manifest.profiles.includes(profile)) {
    ctx.log.error(`Profile "${profile}" is not declared in ${MANIFEST_FILENAME}.`);
    return 1;
  }
  const references = findProfileReferences(manifest, profile);
  if (references.length > 0) {
    ctx.log.error(`Cannot remove profile "${profile}" while it is still used by: ${references.join(", ")}`);
    ctx.log.info(`Run \`marshal profile unscope <app|repo|hook> <name> ${profile}\` for each item first.`);
    return 1;
  }
  const next = validateProfileManifest(ctx, {
    ...manifest,
    profiles: manifest.profiles.filter((p) => p !== profile),
  });
  if (!next) {
    return 1;
  }
  const result = await writeManifestChange(ctx, binding.dotfilesRepo, next, opts, `Will remove profile "${profile}" from ${MANIFEST_FILENAME}.`, `marshal: remove profile ${profile}`);
  if (result.code !== 0 || !result.applied) {
    return result.code;
  }
  if (binding.profile === profile) {
    try {
      writeBindingProfile(null, ctx.homeDir);
      ctx.log.success(`Cleared local active profile "${profile}".`);
    } catch (err) {
      if (err instanceof BindingError) {
        ctx.log.error(err.message);
        return 1;
      }
      throw err;
    }
  }
  return 0;
}

async function profileScope(
  ctx: MarshalContext,
  action: "scope" | "unscope",
  kind: string,
  itemNames: string[],
  profile: string,
  opts: ProfileOptions,
): Promise<number> {
  const loaded = await loadBindingAndManifest(ctx);
  if ("code" in loaded) {
    return loaded.code;
  }
  const { binding, manifest } = loaded;
  try {
    validateProfileName(manifest, profile, `profile ${action}`);
  } catch (err) {
    if (err instanceof ProfileError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
  const scopeKind = parseScopeKind(kind);
  if (!scopeKind) {
    ctx.log.error(`Unknown profile scope kind "${kind}". Expected app, repo, or hook.`);
    return 2;
  }
  const edited = editItemProfiles(manifest, scopeKind, itemNames, profile, action);
  if ("code" in edited) {
    if (edited.message.startsWith("No change")) {
      ctx.log.info(edited.message);
    } else {
      ctx.log.error(edited.message);
    }
    return edited.code;
  }
  const verb = action === "scope" ? "scope" : "remove";
  const names = itemNames.join(", ");
  const summary = action === "scope"
    ? `Will scope ${itemNames.length} ${scopeKind}(s) to profile "${profile}": ${names}.`
    : `Will remove profile "${profile}" from ${itemNames.length} ${scopeKind}(s): ${names}.`;
  const result = await writeManifestChange(ctx, binding.dotfilesRepo, edited.manifest, opts, summary, `marshal: ${verb} ${scopeKind} ${names} ${profile}`);
  return result.code;
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

async function writeManifestChange(
  ctx: MarshalContext,
  dotfilesRepo: string,
  manifest: Manifest,
  opts: ProfileOptions,
  summary: string,
  commitMessage: string,
): Promise<ManifestWriteResult> {
  ctx.log.info(summary);
  if (!opts.yes) {
    const ok = await ctx.prompt.confirm("Apply?");
    if (!ok) {
      ctx.log.info("Aborted.");
      return { code: 0, applied: false };
    }
  }
  const path = join(dotfilesRepo, MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  ctx.log.success(`Updated ${path}`);
  await commitAndPush(ctx, dotfilesRepo, commitMessage);
  return { code: 0, applied: true };
}

function parseScopeKind(kind: string): "app" | "repo" | "hook" | null {
  if (kind === "app" || kind === "apps") {
    return "app";
  }
  if (kind === "repo" || kind === "repos") {
    return "repo";
  }
  if (kind === "hook" || kind === "hooks") {
    return "hook";
  }
  return null;
}

function editItemProfiles(
  manifest: Manifest,
  kind: "app" | "repo" | "hook",
  itemNames: string[],
  profile: string,
  action: "scope" | "unscope",
): { manifest: Manifest } | { code: number; message: string } {
  const uniqueItemNames = [...new Set(itemNames)];
  if (uniqueItemNames.length === 0) {
    return { code: 2, message: "No matching item names were provided." };
  }
  if (kind === "app") {
    const result = editMany(manifest.apps, uniqueItemNames, (a, name) => a.id === name, profile, action);
    if ("code" in result) {
      return result;
    }
    return { manifest: validateManifest({ ...manifest, apps: result.items }) };
  }
  if (kind === "repo") {
    const result = editMany(manifest.repos, uniqueItemNames, (r, name) => r.name === name, profile, action);
    if ("code" in result) {
      return result;
    }
    return { manifest: validateManifest({ ...manifest, repos: result.items }) };
  }
  const result = editMany(manifest.hooks, uniqueItemNames, (h, name) => h.name === name, profile, action);
  if ("code" in result) {
    return result;
  }
  return { manifest: validateManifest({ ...manifest, hooks: result.items }) };
}

function editMany<T extends App | Repo | Hook>(
  items: T[],
  names: string[],
  matches: (item: T, name: string) => boolean,
  profile: string,
  action: "scope" | "unscope",
): { items: T[] } | { code: number; message: string } {
  let next = items;
  let changed = false;
  const noChanges: string[] = [];
  for (const name of names) {
    const result = editOne(next, (item) => matches(item, name), profile, action);
    if ("code" in result) {
      if (result.code === 0) {
        noChanges.push(name);
        continue;
      }
      return { code: result.code, message: `${name}: ${result.message}` };
    }
    next = result.items;
    changed = true;
  }
  if (!changed) {
    return { code: 0, message: `No change: ${noChanges.join(", ")} already matched the requested scope.` };
  }
  return { items: next };
}

function editOne<T extends App | Repo | Hook>(
  items: T[],
  matches: (item: T) => boolean,
  profile: string,
  action: "scope" | "unscope",
): { items: T[] } | { code: number; message: string } {
  const indexes = items.flatMap((item, index) => matches(item) ? [index] : []);
  if (indexes.length === 0) {
    return { code: 1, message: "No matching item in manifest." };
  }
  if (indexes.length > 1) {
    return { code: 1, message: "Multiple matching items in manifest." };
  }
  const index = indexes[0];
  const item = items[index];
  const profiles = item.profiles ?? [];
  if (action === "scope") {
    if (profiles.includes(profile)) {
      return { code: 0, message: `No change: item is already scoped to "${profile}".` };
    }
    return {
      items: replaceAt(items, index, withProfiles(item, [...profiles, profile])),
    };
  }
  if (!profiles.includes(profile)) {
    return { code: 0, message: `No change: item is not scoped to "${profile}".` };
  }
  const nextProfiles = profiles.filter((p) => p !== profile);
  return {
    items: replaceAt(items, index, withProfiles(item, nextProfiles)),
  };
}

function withProfiles<T extends App | Repo | Hook>(item: T, profiles: string[]): T {
  if (profiles.length === 0) {
    const rest = { ...item };
    delete rest.profiles;
    return rest;
  }
  return { ...item, profiles };
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return items.map((existing, i) => i === index ? item : existing);
}

function findProfileReferences(manifest: Manifest, profile: string): string[] {
  return [
    ...manifest.apps.filter((a) => a.profiles?.includes(profile)).map((a) => `app:${a.id}`),
    ...manifest.repos.filter((r) => r.profiles?.includes(profile)).map((r) => `repo:${r.name}`),
    ...manifest.hooks.filter((h) => h.profiles?.includes(profile)).map((h) => `hook:${h.name}`),
  ];
}

function validateProfileManifest(ctx: MarshalContext, manifest: unknown): Manifest | null {
  try {
    return validateManifest(manifest);
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return null;
    }
    throw err;
  }
}
