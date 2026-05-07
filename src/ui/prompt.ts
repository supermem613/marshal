import { createInterface } from "node:readline/promises";

export interface Prompter {
  confirm(message: string, defaultYes?: boolean): Promise<boolean>;
}

export class StdinPrompter implements Prompter {
  async confirm(message: string, defaultYes = false): Promise<boolean> {
    const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(message + suffix)).trim().toLowerCase();
      if (answer === "") {
        return defaultYes;
      }
      return answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  }
}

// Test prompter — returns canned responses in order.
// Throws if responses run out (catches "command asked more than expected").
export class CannedPrompter implements Prompter {
  private answers: boolean[];
  public readonly questions: string[] = [];

  constructor(answers: boolean[]) {
    this.answers = [...answers];
  }

  async confirm(message: string, _defaultYes?: boolean): Promise<boolean> {
    this.questions.push(message);
    if (this.answers.length === 0) {
      throw new Error(`CannedPrompter exhausted at: ${message}`);
    }
    return this.answers.shift()!;
  }
}
