import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MarshalContext } from "../context.js";
import { MANIFEST_FILENAME, validateManifest } from "../manifest.js";
import { writeBinding } from "../binding.js";
import { resolvePath } from "../paths.js";

export interface InitOptions {
  bind?: boolean; // default true: also bind after creating
}

// `marshal init` — write a minimal marshal.json into the cwd (must be
// inside an existing dotfiles repo) and bind to it. The seed manifest is
// intentionally empty so the user fills it in deliberately.
export async function initCommand(ctx: MarshalContext, opts: InitOptions = {}): Promise<number> {
  const cwd = resolvePath(ctx.cwd, ctx.cwd, ctx.homeDir);
  const path = join(cwd, MANIFEST_FILENAME);
  if (existsSync(path)) {
    ctx.log.error(`${MANIFEST_FILENAME} already exists at ${cwd}`);
    return 1;
  }
  const seed = { version: 1, apps: [], repos: [] };
  validateManifest(seed);
  writeFileSync(path, JSON.stringify(seed, null, 2) + "\n", "utf8");
  ctx.log.success(`Wrote ${path}`);

  const shouldBind = opts.bind !== false;
  if (shouldBind) {
    try {
      writeBinding(cwd, ctx.homeDir);
      ctx.log.success(`Bound to ${cwd}`);
    } catch (err) {
      ctx.log.error((err as Error).message);
      return 1;
    }
  }
  return 0;
}
