#!/usr/bin/env node

import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDefaultContext } from "./context.js";
import { cliField, ManifestItemKind } from "./manifest.js";
import { doctorCommand } from "./commands/doctor.js";
import { bindCommand } from "./commands/bind.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { whereCommand } from "./commands/where.js";
import { cdCommand, homeCommand } from "./commands/cd.js";
import { updateCommand } from "./commands/update.js";
import { initCommand } from "./commands/init.js";
import { addAppsCommand, addHooksCommand, addReposCommand, removeItemsCommand } from "./commands/add.js";
import { profileCommand } from "./commands/profile.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const VERSION = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;

const ctx = createDefaultContext(import.meta.url);

const program = new Command();
const csvList = (value: string): string[] => value.split(",").map((s) => s.trim());

function addSchemaOption(command: Command, kind: ManifestItemKind, field: string): Command {
  const option = cliField(kind, field);
  return command.option(option.cliFlag, option.cliDescription);
}

function addSchemaListOption(command: Command, kind: ManifestItemKind, field: "platforms" | "profiles"): Command {
  const option = cliField(kind, field);
  return command.option(option.cliFlag, option.cliDescription, csvList);
}

function addRequiredSchemaOption(command: Command, kind: ManifestItemKind, field: string): Command {
  const option = cliField(kind, field);
  return command.requiredOption(option.cliFlag, option.cliDescription);
}

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

const profile = program
  .command("profile")
  .description("Manage declared profiles, active profile selection, and item scopes")
  .summary("manage profiles and item scopes")
  .addHelpText("after", `

Examples:
  marshal profile list
  marshal profile set work-laptop
  marshal profile add work-laptop -y
  marshal profile scope app work-laptop Git.Git VSCode -y
  marshal profile scope repo work-laptop forge marshal -y
  marshal profile unscope hook work-laptop config-sync prompt-sync -y
  marshal profile remove work-laptop -y

Scope kinds:
  app     app id from apps[]
  repo    repo name from repos[]
  hook    hook name from hooks[]
`)
  .action(async () => {
    process.exit(await profileCommand(ctx, "get"));
  });

profile
  .command("list")
  .description("List declared manifest profiles and mark the active local profile")
  .action(async () => {
    process.exit(await profileCommand(ctx, "list"));
  });

profile
  .command("get")
  .description("Print the machine-local active profile from ~/.marshal.json")
  .action(async () => {
    process.exit(await profileCommand(ctx, "get"));
  });

profile
  .command("set <name>")
  .description("Set the machine-local active profile after validating it is declared")
  .action(async (name) => {
    process.exit(await profileCommand(ctx, "set", name));
  });

profile
  .command("clear")
  .description("Clear the machine-local active profile without changing marshal.json")
  .action(async () => {
    process.exit(await profileCommand(ctx, "clear"));
  });

profile
  .command("add <name>")
  .description("Declare a new top-level profile in marshal.json")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name, opts) => {
    process.exit(await profileCommand(ctx, "add", name, undefined, undefined, opts));
  });

profile
  .command("remove <name>")
  .description("Remove an unused declared profile from marshal.json")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name, opts) => {
    process.exit(await profileCommand(ctx, "remove", name, undefined, undefined, opts));
  });

profile
  .command("scope <kind> <profile> <items...>")
  .description("Scope one or more existing apps, repos, or hooks to a declared profile")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Arguments:
  kind     app, repo, or hook
  profile  declared profile name
  items    one or more app ids, repo names, or hook names

Examples:
  marshal profile scope app work-laptop Git.Git OpenJS.NodeJS.LTS -y
  marshal profile scope repo work-laptop forge marshal -y
  marshal profile scope hook work-laptop config-sync prompt-sync -y
`)
  .action(async (kind, name, items, opts) => {
    process.exit(await profileCommand(ctx, "scope", kind, items, name, opts));
  });

profile
  .command("unscope <kind> <profile> <items...>")
  .description("Remove a profile from one or more existing app, repo, or hook scopes")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Arguments:
  kind     app, repo, or hook
  profile  declared profile name
  items    one or more app ids, repo names, or hook names

Examples:
  marshal profile unscope app work-laptop Git.Git OpenJS.NodeJS.LTS -y
  marshal profile unscope repo work-laptop forge marshal -y
  marshal profile unscope hook work-laptop config-sync prompt-sync -y
`)
  .action(async (kind, name, items, opts) => {
    process.exit(await profileCommand(ctx, "unscope", kind, items, name, opts));
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
  .command("add <url>")
  .description("Add one tool repo to the manifest. Run `marshal sync` to apply, or pass --sync.")
  .option(cliField("repo", "name").cliFlag, cliField("repo", "name").cliDescription)
  .option(cliField("repo", "install_cmd").cliFlag, cliField("repo", "install_cmd").cliDescription)
  .option(cliField("repo", "update_cmd").cliFlag, cliField("repo", "update_cmd").cliDescription)
  .option(cliField("repo", "install_cwd").cliFlag, cliField("repo", "install_cwd").cliDescription)
  .option(cliField("repo", "platforms").cliFlag, cliField("repo", "platforms").cliDescription, csvList)
  .option(cliField("repo", "profiles").cliFlag, cliField("repo", "profiles").cliDescription, csvList)
  .option("--sync", "Also run sync after writing the manifest")
  .addOption(new Option("--no-sync").hideHelp())
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal add https://github.com/me/tool.git -y
  marshal add https://github.com/me/tool.git --name tool-alpha --profiles work-laptop -y
`)
  .action(async (url, opts) => {
    process.exit(await addReposCommand(ctx, [{ url, name: opts.name }], opts));
  });

const addApp = program
  .command("add-app <id>")
  .description("Add one prerequisite app to the manifest. Run `marshal sync` to apply, or pass --sync.");
addSchemaListOption(addApp, "app", "platforms");
addSchemaListOption(addApp, "app", "profiles");
addApp
  .option("--sync", "Also run sync after writing the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal add-app Git.Git -y
  marshal add-app Corp.VPN --profiles work-laptop -y
`)
  .action(async (id, opts) => {
    process.exit(await addAppsCommand(ctx, [id], opts));
  });

const addHook = program
  .command("add-hook <name>")
  .description("Add one sync hook to the manifest. Run `marshal sync` to apply, or pass --sync.");
addRequiredSchemaOption(addHook, "hook", "cmd");
addSchemaOption(addHook, "hook", "cwd");
addSchemaOption(addHook, "hook", "interactive");
addSchemaListOption(addHook, "hook", "platforms");
addSchemaListOption(addHook, "hook", "profiles");
addHook
  .option("--sync", "Also run sync after writing the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal add-hook config-sync --cmd "configsync sync" --interactive -y
`)
  .action(async (name, opts) => {
    process.exit(await addHooksCommand(ctx, [name], opts));
  });

program
  .command("remove <repo>")
  .description("Remove one tool repo from the manifest")
  .option("--keep-files", "Do not delete the cloned repo directory")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal remove tool-alpha -y
  Repo removals delete cloned repo directories unless --keep-files is passed.
  Use remove-app for apps and remove-hook for hooks.
`)
  .action(async (repo, opts) => {
    process.exit(await removeItemsCommand(ctx, {
      repos: [repo],
    }, { yes: opts.yes, deleteFiles: !opts.keepFiles }));
  });

program
  .command("remove-app <id>")
  .description("Remove one prerequisite app from the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal remove-app Git.Git -y
`)
  .action(async (id, opts) => {
    process.exit(await removeItemsCommand(ctx, {
      apps: [id],
    }, { yes: opts.yes, deleteFiles: false }));
  });

program
  .command("remove-hook <name>")
  .description("Remove one sync hook from the manifest")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `

Examples:
  marshal remove-hook config-sync -y
`)
  .action(async (name, opts) => {
    process.exit(await removeItemsCommand(ctx, {
      hooks: [name],
    }, { yes: opts.yes, deleteFiles: false }));
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
