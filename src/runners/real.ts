import { spawn, type SpawnOptions, type StdioOptions } from "node:child_process";
import { ExecOptions, ExecResult, ProcessError, ProcessRunner } from "./types.js";

// Real implementation: runs commands through the platform shell so PATH
// resolution, .cmd shims (Windows), and quoting work as users expect.
// shell:true is required on Windows for npm/git/winget to resolve their .cmd
// shims under current Node runtimes (CVE-2024-27980 mitigation).
export class RealProcessRunner implements ProcessRunner {
  exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const cwd = opts.cwd ?? process.cwd();
    return new Promise((resolve, reject) => {
      const stdio: StdioOptions = opts.interactive
        ? "inherit"
        : opts.inherit
          ? ["inherit", "pipe", "pipe"]
          : ["ignore", "pipe", "pipe"];
      const spawnOptions: SpawnOptions = {
        cwd,
        env: opts.env ?? process.env,
        shell: true,
        stdio,
      };
      const child = spawn(command, spawnOptions);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        const s = d.toString();
        stdout += s;
        if (opts.inherit) {
          process.stdout.write(s);
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString();
        stderr += s;
        if (opts.inherit) {
          process.stderr.write(s);
        }
      });
      child.on("error", reject);
      child.on("close", (code: number | null) => {
        const result: ExecResult = {
          command,
          cwd,
          code: code ?? -1,
          stdout,
          stderr,
        };
        if ((code ?? -1) !== 0 && !opts.allowNonZero) {
          reject(new ProcessError(`Command failed (exit ${code}): ${command}\n${stderr}`, result));
          return;
        }
        resolve(result);
      });
    });
  }
}
