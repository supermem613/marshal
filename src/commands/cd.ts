import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";

// Cd / Home — spawn an interactive subshell rooted at the target directory.
// A child process can't change its parent shell's cwd, so this matches the
// rotunda / chezmoi pattern: open a subshell, exit returns to the original.

function pickShell(): string {
  if (process.platform === "win32") {
    if (process.env.PSModulePath) {
      return "pwsh";
    }
    return "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/sh";
}

export function spawnSubshell(targetDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const shell = pickShell();
    const child = spawn(shell, [], {
      cwd: targetDir,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export async function cdCommand(ctx: MarshalContext): Promise<number> {
  try {
    const b = requireBinding(ctx.homeDir);
    if (!existsSync(b.dotfilesRepo)) {
      ctx.log.error(`Bound dotfiles path no longer exists: ${b.dotfilesRepo}`);
      return 1;
    }
    return await spawnSubshell(b.dotfilesRepo);
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
}

export async function homeCommand(ctx: MarshalContext): Promise<number> {
  if (!existsSync(ctx.marshalSourceDir)) {
    ctx.log.error(`Marshal source dir not found: ${ctx.marshalSourceDir}`);
    return 1;
  }
  return await spawnSubshell(ctx.marshalSourceDir);
}
