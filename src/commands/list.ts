import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
import { readManifest, ManifestError } from "../manifest.js";
import { buildPlan } from "../plan.js";

export interface ListOptions {
  json?: boolean;
}

// `marshal list` — visual fleet inventory. Showing both applies/skipped
// (platform filter) and installed/missing (filesystem state) gives the
// user a single screen to understand "what should be on this machine and
// what is on this machine."
export async function listCommand(ctx: MarshalContext, opts: ListOptions): Promise<number> {
  let bound: string;
  try {
    bound = requireBinding(ctx.homeDir).dotfilesRepo;
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  let manifest;
  try {
    manifest = readManifest(bound);
  } catch (err) {
    if (err instanceof ManifestError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }

  const plan = buildPlan({
    ...manifest,
  }, {
    homeDir: ctx.homeDir,
    dotfilesRepo: bound,
    platform: ctx.platform,
  });

  if (opts.json) {
    ctx.log.raw(JSON.stringify({
      bound,
      platform: ctx.platform,
      reposPath: plan.reposPath,
      apps: manifest.apps,
      repos: manifest.repos,
      hooks: manifest.hooks,
    }, null, 2) + "\n");
    return 0;
  }

  ctx.log.info(`Bound:     ${bound}`);
  ctx.log.info(`Platform:  ${ctx.platform}`);
  ctx.log.info(`reposPath: ${plan.reposPath}`);
  ctx.log.info("");
  ctx.log.info(`apps (${manifest.apps.length}):`);
  for (const a of manifest.apps) {
    const platforms = a.platforms ? ` [${a.platforms.join(",")}]` : "";
    ctx.log.info(`  ${a.id}${platforms}`);
  }
  ctx.log.info("");
  ctx.log.info(`repos (${manifest.repos.length}):`);
  for (const r of manifest.repos) {
    const platforms = r.platforms ? ` [${r.platforms.join(",")}]` : "";
    const cwd = r.install_cwd ? ` (cwd: ${r.install_cwd})` : "";
    const update = r.update_cmd ? ` update=${r.update_cmd}` : "";
    ctx.log.info(`  ${r.name.padEnd(20)} ${r.url}${platforms}${cwd}${update}`);
  }
  ctx.log.info("");
  ctx.log.info(`hooks (${manifest.hooks.length}):`);
  for (const h of manifest.hooks) {
    const platforms = h.platforms ? ` [${h.platforms.join(",")}]` : "";
    const cwd = h.cwd ? ` (cwd: ${h.cwd})` : "";
    const mode = h.interactive ? " interactive" : "";
    ctx.log.info(`  ${h.name.padEnd(20)} ${h.stage} ${h.cmd}${platforms}${cwd}${mode}`);
  }
  return 0;
}
