// ProcessRunner — abstracts spawning external commands (git, npm, winget,
// shell scripts) so tests can substitute a recording mock without touching
// real processes. Default implementation in `real.ts`.

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  // If true, swallow non-zero exits (still returns full result).
  // Default: throw on non-zero.
  allowNonZero?: boolean;
  // If true, stream stdout/stderr to the parent process while also capturing.
  inherit?: boolean;
  // If true, give the child a real terminal. Interactive commands cannot be
  // captured safely, so stdout/stderr in the ExecResult may be empty.
  interactive?: boolean;
}

export interface ExecResult {
  command: string;
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}
