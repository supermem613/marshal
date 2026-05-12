import { ExecResult } from "./runners/types.js";

export function gitPullMadeNoChanges(result: Pick<ExecResult, "stdout" | "stderr">): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return /already up[- ]to[- ]date\.?/i.test(output);
}
