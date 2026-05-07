import chalk from "chalk";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  success(msg: string): void;
  dim(msg: string): void;
  raw(msg: string): void;
  // Captured output (test-only — empty array on real logger).
  readonly captured: string[];
}

// Default logger writes to stdout/stderr with chalk colors.
export class ConsoleLogger implements Logger {
  readonly captured: string[] = [];

  info(msg: string): void {
    process.stdout.write(msg + "\n");
  }

  warn(msg: string): void {
    process.stderr.write(chalk.yellow(`! ${msg}`) + "\n");
  }

  error(msg: string): void {
    process.stderr.write(chalk.red(`✗ ${msg}`) + "\n");
  }

  success(msg: string): void {
    process.stdout.write(chalk.green(`✓ ${msg}`) + "\n");
  }

  dim(msg: string): void {
    process.stdout.write(chalk.dim(msg) + "\n");
  }

  raw(msg: string): void {
    process.stdout.write(msg);
  }
}

// Test logger — captures all output for assertions. Stays color-free so
// tests can assert on plain strings.
export class CaptureLogger implements Logger {
  readonly captured: string[] = [];

  info(msg: string): void {
    this.captured.push(`info: ${msg}`);
  }

  warn(msg: string): void {
    this.captured.push(`warn: ${msg}`);
  }

  error(msg: string): void {
    this.captured.push(`error: ${msg}`);
  }

  success(msg: string): void {
    this.captured.push(`success: ${msg}`);
  }

  dim(msg: string): void {
    this.captured.push(`dim: ${msg}`);
  }

  raw(msg: string): void {
    this.captured.push(`raw: ${msg}`);
  }
}
