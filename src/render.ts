import { Plan, RepoStep } from "./plan.js";
import { formatActiveProfile } from "./profile.js";
import { Logger } from "./ui/log.js";

// Render a Plan as human-readable text. Pure function over Plan + Logger
// so tests can assert on captured lines.

const ACTION_LABEL: Record<RepoStep["action"], string> = {
  "clone-and-install": "CLONE + INSTALL",
  "clone": "CLONE",
  "update": "UPDATE",
  "pull-and-install": "PULL + INSTALL",
  "pull": "PULL",
};

export function renderPlan(plan: Plan, log: Logger): void {
  const total = plan.apps.length + plan.repos.length + plan.hooks.length;
  if (total === 0) {
    log.info(`Plan (${plan.platform}, profile: ${formatActiveProfile(plan.activeProfile)}): nothing to do.`);
    return;
  }
  log.info(`Plan (${plan.platform}, profile: ${formatActiveProfile(plan.activeProfile)}): ${plan.apps.length} app(s), ${plan.repos.length} repo(s), ${plan.hooks.length} hook(s)`);
  if (plan.apps.length > 0) {
    log.info("");
    log.info("  Apps (winget install):");
    for (const a of plan.apps) {
      log.info(`    • ${a.id}`);
    }
  }
  if (plan.repos.length > 0) {
    log.info("");
    log.info(`  Repos (clone target: ${plan.reposPath}):`);
    for (const r of plan.repos) {
      log.info(`    • ${r.name.padEnd(20)} ${ACTION_LABEL[r.action].padEnd(18)} ${r.url}`);
    }
  }
  if (plan.hooks.length > 0) {
    log.info("");
    log.info("  Hooks (after repos):");
    for (const h of plan.hooks) {
      const mode = h.interactive ? "[interactive] " : "";
      log.info(`    • ${h.name.padEnd(20)} ${mode}${h.command}`);
    }
  }
}

export interface ExecutionResult {
  step: string;
  ok: boolean;
  detail?: string;
}

export function renderResults(results: ExecutionResult[], log: Logger): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  log.info("");
  log.info(`Results: ${passed} ok, ${failed} failed`);
  for (const r of results) {
    if (r.ok) {
      log.success(`${r.step}${r.detail ? ` — ${r.detail}` : ""}`);
    } else {
      log.error(`${r.step}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
}
