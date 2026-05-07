import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";
import { readManifest, ManifestError } from "../manifest.js";
import { buildPlan } from "../plan.js";

export interface StatusOptions {
  json?: boolean;
}

interface RepoStatusRow {
  name: string;
  url: string;
  applies: boolean;
  installed: boolean;
  targetDir: string;
}

interface AppStatusRow {
  id: string;
  applies: boolean;
}

interface StatusReport {
  bound: string;
  platform: string;
  apps: AppStatusRow[];
  repos: RepoStatusRow[];
}

export async function statusCommand(ctx: MarshalContext, opts: StatusOptions): Promise<number> {
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

  const plan = buildPlan(manifest, {
    homeDir: ctx.homeDir,
    dotfilesRepo: bound,
    platform: ctx.platform,
  });
  const planRepoNames = new Set(plan.repos.map((r) => r.name));
  const planAppIds = new Set(plan.apps.map((a) => a.id));

  const apps: AppStatusRow[] = manifest.apps.map((a) => ({
    id: a.id,
    applies: planAppIds.has(a.id),
  }));
  const repos: RepoStatusRow[] = manifest.repos.map((r) => {
    const planRow = plan.repos.find((p) => p.name === r.name);
    return {
      name: r.name,
      url: r.url,
      applies: planRepoNames.has(r.name),
      installed: planRow ? planRow.exists : false,
      targetDir: planRow ? planRow.targetDir : "",
    };
  });

  const report: StatusReport = {
    bound,
    platform: ctx.platform,
    apps,
    repos,
  };

  if (opts.json) {
    ctx.log.raw(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  ctx.log.info(`Bound: ${bound}`);
  ctx.log.info(`Platform: ${ctx.platform}`);
  ctx.log.info("");
  if (apps.length > 0) {
    ctx.log.info("Apps:");
    for (const a of apps) {
      const tag = a.applies ? "  applies " : "  skipped ";
      ctx.log.info(`${tag} ${a.id}`);
    }
    ctx.log.info("");
  }
  if (repos.length > 0) {
    ctx.log.info("Repos:");
    for (const r of repos) {
      let tag: string;
      if (!r.applies) {
        tag = "  skipped  ";
      } else if (r.installed) {
        tag = "  installed";
      } else {
        tag = "  missing  ";
      }
      ctx.log.info(`${tag} ${r.name.padEnd(20)} ${r.url}`);
    }
  }

  const missing = repos.filter((r) => r.applies && !r.installed).length;
  ctx.log.info("");
  if (missing > 0) {
    ctx.log.warn(`${missing} repo(s) missing — run \`marshal sync\` to install.`);
  } else {
    ctx.log.success("All applicable repos installed.");
  }
  return 0;
}
