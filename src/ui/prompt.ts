import { createInterface } from "node:readline/promises";

export interface Prompter {
  confirm(message: string, defaultYes?: boolean): Promise<boolean>;
  // Present a numbered menu and return the chosen value. choices must be non-empty.
  // Implementations must fail loudly rather than guess when no answer is available.
  select(message: string, choices: string[]): Promise<string>;
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

  async select(message: string, choices: string[]): Promise<string> {
    if (choices.length === 0) {
      throw new Error(`select called with no choices: ${message}`);
    }
    // A non-interactive stdin cannot answer a menu. Fail loudly so callers
    // surface a flag-based bypass instead of hanging on EOF.
    if (!process.stdin.isTTY) {
      throw new Error(`Cannot prompt for "${message}" without a terminal. Pass the value explicitly.`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        process.stdout.write(`${message}\n`);
        choices.forEach((choice, i) => process.stdout.write(`  ${i + 1}) ${choice}\n`));
        const answer = (await rl.question(`Select 1-${choices.length}: `)).trim();
        const index = Number.parseInt(answer, 10);
        if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
          return choices[index - 1];
        }
        process.stdout.write(`Invalid selection: ${answer}\n`);
      }
    } finally {
      rl.close();
    }
  }
}

// Test prompter — returns canned responses in order.
// Throws if responses run out (catches "command asked more than expected").
export class CannedPrompter implements Prompter {
  private answers: boolean[];
  private selections: string[];
  public readonly questions: string[] = [];
  public readonly selectQuestions: string[] = [];

  constructor(answers: boolean[], selections: string[] = []) {
    this.answers = [...answers];
    this.selections = [...selections];
  }

  async confirm(message: string, _defaultYes?: boolean): Promise<boolean> {
    this.questions.push(message);
    if (this.answers.length === 0) {
      throw new Error(`CannedPrompter exhausted at: ${message}`);
    }
    return this.answers.shift()!;
  }

  async select(message: string, choices: string[]): Promise<string> {
    this.selectQuestions.push(message);
    if (this.selections.length === 0) {
      throw new Error(`CannedPrompter exhausted (select) at: ${message}`);
    }
    const choice = this.selections.shift()!;
    if (!choices.includes(choice)) {
      throw new Error(`CannedPrompter select "${choice}" not in choices: ${choices.join(", ")}`);
    }
    return choice;
  }
}
