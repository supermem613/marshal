import { ExecOptions, ExecResult, ProcessRunner } from "./types.js";

// Recording mock for tests. Records every exec() call and returns canned
// responses by command-prefix match. Default response is { code: 0, stdout: "", stderr: "" }.
//
// Usage:
//   const runner = new MockProcessRunner()
//     .respond(/^git clone/, { stdout: "Cloning..." })
//     .respond("npm install", { code: 0 });
//   await someCommand(ctx);
//   assert.deepEqual(runner.calls.map((c) => c.command), [...]);

export interface MockResponse {
  code?: number;
  stdout?: string;
  stderr?: string;
  // If set, exec() throws ProcessError with this result.
  fail?: boolean;
}

interface Matcher {
  pattern: string | RegExp;
  response: MockResponse;
}

export class MockProcessRunner implements ProcessRunner {
  public readonly calls: Array<{ command: string; opts: ExecOptions }> = [];
  private matchers: Matcher[] = [];
  private defaultResponse: MockResponse = { code: 0, stdout: "", stderr: "" };

  respond(pattern: string | RegExp, response: MockResponse): this {
    this.matchers.push({ pattern, response });
    return this;
  }

  setDefault(response: MockResponse): this {
    this.defaultResponse = response;
    return this;
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    this.calls.push({ command, opts });
    const matched = this.matchers.find((m) =>
      typeof m.pattern === "string" ? command.startsWith(m.pattern) : m.pattern.test(command),
    );
    const response = matched?.response ?? this.defaultResponse;
    const result: ExecResult = {
      command,
      cwd: opts.cwd ?? process.cwd(),
      code: response.code ?? 0,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    };
    if (response.fail) {
      const { ProcessError } = await import("./types.js");
      throw new ProcessError(`Mock failure: ${command}`, result);
    }
    return result;
  }

  reset(): void {
    this.calls.length = 0;
    this.matchers.length = 0;
  }
}
