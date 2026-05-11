#!/usr/bin/env node

import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDefaultContext } from "./context.js";
import { doctorCommand } from "./commands/doctor.js";
import { bindCommand } from "./commands/bind.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { whereCommand } from "./commands/where.js";
import { cdCommand, homeCommand } from "./commands/cd.js";
import { updateCommand } from "./commands/update.js";
import { initCommand } from "./commands/init.js";
import { addAppCommand, addCommand, addHookCommand, removeCommand } from "./commands/add.js";
import { profileCommand } from "./commands/profile.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const VERSION = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;

const ctx = createDefaultContext(import.meta.url);

const program = new Command();

program
  .name("marshal")
  .description("Bind to a dotfiles repo and provision your CLI tool fleet — clone, build, install, and update everything from one manifest.")
  .version(VERSION);

program
  .command("doctor")
  .description("Health check: verify environment and configuration")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(async (opts) => {
    process.exit(await doctorCommand(ctx, opts));
  });

program
  .command("bind [target]")
  .description("Bind marshal to a dotfiles repo. <target> is a clonable URL or a local path.")
  .option("--path <path>", "Where to clone the dotfiles repo (when <target> is a URL). Default: ~/repos/<repo-name>")
  .option("--show", "Print the current binding")
  .option("--unset", "Clear the current binding")
  .option("--no-sync", "Skip auto-sync after URL bind")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (target, opts) => {
    process.exit(await bindCommand(ctx, target, opts));
  });

program
  .command("init")
  .description("Create a minimal marshal.json in the current directory and bind to it")
  .option("--no-bind", "Create the manifest but do not bind")
  .action(async (opts) => {
    process.exit(await initCommand(ctx, opts));
  });

program
  .command("sync [repos...]")
  .description("Provision the bound fleet: install apps, clone/build/update repos, then run configured hooks.")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--hooks", "Run configured sync hooks even when limiting sync to named repos")
  .option("--profile <name>", "Use a profile for this sync only; does not update ~/.marshal.json")
  .action(async (repos, opts) => {
    process.exit(await syncCommand(ctx, { yes: opts.yes, repos, hooks: opts.hooks, profile: opts.profile }));
  });

program
  .command("status")
  .description("Show what is bound, what applies to this platform, and what is installed")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts) => {
    process.exit(await statusCommand(ctx, opts));
  });

program
  .command("list")
  .description("List the full manifest contents (apps, repos, hooks, with platform filters)")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts) => {
    process.exit(await listCommand(ctx, opts));
  });

program
  .command("profile [action] [name]")
  .description("Show, list, set, or clear the machine-local active profile")
  .action(async (action, name) => {
    process.exit(await profileCommand(ctx, action, name));
  });

program
  .command("where")
  .description("Print the absolute path of the bound dotfiles repo")
  .action(async () => {
    process.exit(await whereCommand(ctx));
  });

program
  .command("cd")
  .description("Spawn a subshell rooted at the bound dotfiles repo")
  .action(async () => {
    process.exit(await cdCommand(ctx));
  });

program
  .command("home")
  .description("Spawn a subshell rooted at the marshal source repo")
  .action(async () => {
    process.exit(await homeCommand(ctx));
  });

program
  .command("update")
  .description("Self-update marshal: git pull, then npm install + npm run build only when changes land")
  .action(async () => {
    process.exit(await updateCommand(ctx));
  });

program
  .command("add <url> [name]")
  .description("Add a tool repo to the manifest. Run `marshal sync` to apply, or pass --sync.")
  .option("--install-cmd <cmd>", "Install command to run after clone/pull")
  .option("--update-cmd <cmd>", "Update command (default: rerun install_cmd after git pull)")
  .option("--install-cwd <subdir>", "Subdirectory inside the repo where install runs")
  .option("--platforms <list>", "Comma-separated platform list (win32,darwin,linux)", (v) => v.split(",").map((s) => s.trim()))
  .option("--profiles <list>", "Comma-separated profile list declared in marshal.json", (v) => v.split(",").map((s) => s.trim()))
  .option("--sync", "Also run sync after writing the manifest")
  .addOption(new Option("--no-sync").hideHelp())
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (url, name, opts) => {
    process.exit(await addCommand(ctx, url, name, opts));
  });

program
  .command("add-app <id>")
  .description("Add a prerequisite app to the manifest. Run `marshal sync` to apply, or pass --sync.")
  .option("--platforms <list>", "Comma-separated platform list (win32,darwin,linux)", (v) => v.split(",").map((s) => s.trim()))
  .option("--profiles <list>", "Comma-separated profile list declared in marshal.json", (v) => v.split(",").map((s) => s.trim()))
  .option("--sync", "Also run sync after writing the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (id, opts) => {
    process.exit(await addAppCommand(ctx, id, opts));
  });

program
  .command("add-hook <name>")
  .description("Add a sync hook to the manifest. Run `marshal sync` to apply, or pass --sync.")
  .requiredOption("--cmd <cmd>", "Shell command to run during sync")
  .option("--cwd <path>", "Relative path under the bound dotfiles repo where the hook runs")
  .option("--interactive", "Run the hook with a real terminal attached")
  .option("--platforms <list>", "Comma-separated platform list (win32,darwin,linux)", (v) => v.split(",").map((s) => s.trim()))
  .option("--profiles <list>", "Comma-separated profile list declared in marshal.json", (v) => v.split(",").map((s) => s.trim()))
  .option("--sync", "Also run sync after writing the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name, opts) => {
    process.exit(await addHookCommand(ctx, name, opts));
  });

program
  .command("remove <name>")
  .description("Remove a tool repo from the manifest (and delete its cloned directory)")
  .option("--keep-files", "Do not delete the cloned repo directory")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name, opts) => {
    process.exit(await removeCommand(ctx, name, { yes: opts.yes, deleteFiles: !opts.keepFiles }));
  });

// Bare `marshal` (no args) prints version + full help. Matches the
// rotunda/kash/reflux convention. No version banner before sub-commands
// so machine-parseable output stays clean.
if (process.argv.slice(2).length === 0) {
  process.stdout.write(`marshal v${VERSION}\n\n`);
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
