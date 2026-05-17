import chalk from "chalk";
import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
import { App, Hook, readManifest, Manifest, ManifestError, Repo } from "../manifest.js";
import { buildPlan } from "../plan.js";
import { formatActiveProfile, profileApplies, ProfileError, resolveActiveProfile } from "../profile.js";

export interface ListOptions {
  json?: boolean;
}

// `marshal list` — visual fleet inventory. Showing both applies/skipped
// (platform filter) and installed/missing (filesystem state) gives the
// user a single screen to understand "what should be on this machine and
// what is on this machine."
export async function listCommand(ctx: MarshalContext, opts: ListOptions): Promise<number> {
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

  let manifest;
  try {
    manifest = readManifest(binding.dotfilesRepo);
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  let activeProfile;
  try {
    activeProfile = resolveActiveProfile(manifest, binding);
  } catch (err) {
    if (err instanceof ProfileError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  const plan = buildPlan({
    ...manifest,
  }, {
    homeDir: ctx.homeDir,
    dotfilesRepo: binding.dotfilesRepo,
    platform: ctx.platform,
    activeProfile,
  });

  if (opts.json) {
    ctx.log.raw(JSON.stringify({
      bound: binding.dotfilesRepo,
      platform: ctx.platform,
      profile: activeProfile.profile,
      profileSource: activeProfile.source,
      reposPath: plan.reposPath,
      profiles: manifest.profiles,
      apps: manifest.apps,
      repos: manifest.repos,
      hooks: manifest.hooks,
    }, null, 2) + "\n");
    return 0;
  }

  const planAppIds = new Set(plan.apps.map((a) => a.id));
  const planRepoNames = new Set(plan.repos.map((r) => r.name));
  const planHookNames = new Set(plan.hooks.map((h) => h.name));

  ctx.log.info("");
  ctx.log.info(chalk.bold.cyan("  ┌─ marshal manifest"));
  ctx.log.dim(`  │  bound:    ${binding.dotfilesRepo}`);
  ctx.log.dim(`  │  platform: ${ctx.platform}`);
  ctx.log.dim(`  │  profile:  ${formatActiveProfile(activeProfile)}`);
  ctx.log.dim(`  │  repos:    ${plan.reposPath}`);
  renderProfiles(ctx, manifest, activeProfile.profile);
  renderApps(ctx, manifest.apps, planAppIds);
  renderRepos(ctx, manifest.repos, planRepoNames);
  renderHooks(ctx, manifest.hooks, planHookNames);
  ctx.log.dim("  │");
  ctx.log.info(chalk.cyan(`  └─ ${manifest.apps.length} apps, ${manifest.repos.length} repos, ${manifest.hooks.length} hooks`));
  ctx.log.info("");
  ctx.log.dim(`  Legend: ${chalk.green("◉")} applies  ${chalk.dim("○")} skipped  scope: shared means every profile`);
  return 0;
}

function renderProfiles(ctx: MarshalContext, manifest: Manifest, activeProfile: string | null): void {
  ctx.log.dim("  │");
  ctx.log.info(chalk.bold(`  │  profiles (${manifest.profiles.length})`));
  if (manifest.profiles.length === 0) {
    ctx.log.dim("  │    (none declared)");
    return;
  }
  for (const profile of manifest.profiles) {
    const marker = profile === activeProfile ? chalk.green("◉") : chalk.dim("○");
    const active = profile === activeProfile ? " active" : "";
    const counts = profileCounts(manifest, profile);
    ctx.log.info(`  │    ${marker} ${profile.padEnd(20)} ${counts}${active}`);
  }
}

function renderApps(ctx: MarshalContext, apps: App[], planAppIds: Set<string>): void {
  ctx.log.dim("  │");
  ctx.log.info(chalk.bold(`  │  apps (${apps.length})`));
  if (apps.length === 0) {
    ctx.log.dim("  │    (none)");
    return;
  }
  for (const app of apps) {
    const applies = planAppIds.has(app.id);
    ctx.log.info(`  │    ${indicator(applies)} ${app.id.padEnd(24)} ${scopeLabel(app.profiles)}${platformLabel(app.platforms)}`);
  }
}

function renderRepos(ctx: MarshalContext, repos: Repo[], planRepoNames: Set<string>): void {
  ctx.log.dim("  │");
  ctx.log.info(chalk.bold(`  │  repos (${repos.length})`));
  if (repos.length === 0) {
    ctx.log.dim("  │    (none)");
    return;
  }
  for (const repo of repos) {
    const applies = planRepoNames.has(repo.name);
    const metadata = [
      scopeLabel(repo.profiles),
      platformLabel(repo.platforms),
      repo.install_cwd ? `cwd: ${repo.install_cwd}` : "",
    ].filter(Boolean).join("  ");
    ctx.log.info(`  │    ${indicator(applies)} ${repo.name.padEnd(24)} ${repo.url}`);
    ctx.log.dim(`  │      ${metadata || "scope: shared"}`);
    if (repo.install_cmd) {
      ctx.log.dim(`  │      install: ${repo.install_cmd}`);
    }
    if (repo.update_cmd) {
      ctx.log.dim(`  │      update:  ${repo.update_cmd}`);
    }
  }
}

function renderHooks(ctx: MarshalContext, hooks: Hook[], planHookNames: Set<string>): void {
  ctx.log.dim("  │");
  ctx.log.info(chalk.bold(`  │  hooks (${hooks.length})`));
  if (hooks.length === 0) {
    ctx.log.dim("  │    (none)");
    return;
  }
  for (const hook of hooks) {
    const applies = planHookNames.has(hook.name);
    const metadata = [
      scopeLabel(hook.profiles),
      platformLabel(hook.platforms),
      hook.cwd ? `cwd: ${hook.cwd}` : "",
      hook.interactive ? "interactive" : "non-interactive",
    ].filter(Boolean).join("  ");
    ctx.log.info(`  │    ${indicator(applies)} ${hook.name.padEnd(24)} ${hook.stage}`);
    ctx.log.dim(`  │      ${metadata}`);
    ctx.log.dim(`  │      command: ${hook.cmd}`);
  }
}

function indicator(applies: boolean): string {
  return applies ? chalk.green("◉") : chalk.dim("○");
}

function scopeLabel(profiles: string[] | undefined): string {
  return profiles && profiles.length > 0 ? `scope: ${profiles.join(", ")}` : "scope: shared";
}

function platformLabel(platforms: string[] | undefined): string {
  return platforms && platforms.length > 0 ? `  platforms: ${platforms.join(", ")}` : "";
}

function profileCounts(manifest: Manifest, profile: string): string {
  const apps = manifest.apps.filter((app) => profileApplies(app.profiles, profile)).length;
  const repos = manifest.repos.filter((repo) => profileApplies(repo.profiles, profile)).length;
  const hooks = manifest.hooks.filter((hook) => profileApplies(hook.profiles, profile)).length;
  return `${apps} apps, ${repos} repos, ${hooks} hooks`;
}
