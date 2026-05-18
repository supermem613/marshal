import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { SUPPORTED_PLATFORMS } from "./platform.js";

// `marshal.json` lives at the root of the dotfiles repo (sibling to
// `rotunda.json`). It is the single source of truth for what tools and apps
// a machine should have. Schema is intentionally small — every field earns
// its place.

export const MANIFEST_FILENAME = "marshal.json";

export type ManifestItemKind = "app" | "repo" | "hook";

export interface ManifestFieldDoc {
  description: string;
  cliFlag?: string;
  cliDescription?: string;
}

export const ManifestFieldDocs = {
  app: {
    id: {
      description: "Winget package identifier.",
    },
    platforms: {
      description: "Array of platform names. Absent means all platforms.",
      cliFlag: "--platforms <list>",
      cliDescription: "Comma-separated platform list (win32,darwin,linux)",
    },
    profiles: {
      description: "Array of declared profile names. Absent means shared across all profiles.",
      cliFlag: "--profiles <list>",
      cliDescription: "Comma-separated profile list declared in marshal.json",
    },
  },
  repo: {
    name: {
      description: "Kebab-case unique identifier. Becomes the folder name under reposPath.",
      cliFlag: "--name <name>",
      cliDescription: "Manifest repo name",
    },
    url: {
      description: "Clonable URL accepted by git clone.",
    },
    platforms: {
      description: "Array of platform names. Absent means all platforms.",
      cliFlag: "--platforms <list>",
      cliDescription: "Comma-separated platform list (win32,darwin,linux)",
    },
    profiles: {
      description: "Array of declared profile names. Absent means shared across all profiles.",
      cliFlag: "--profiles <list>",
      cliDescription: "Comma-separated profile list declared in marshal.json",
    },
    install_cwd: {
      description: "Subdirectory inside the repo where install_cmd and update_cmd run.",
      cliFlag: "--install-cwd <subdir>",
      cliDescription: "Subdirectory inside the repo where install and update commands run",
    },
    install_cmd: {
      description: "Shell command to build or install the tool after clone or pull.",
      cliFlag: "--install-cmd <cmd>",
      cliDescription: "Install command to run after clone or pull",
    },
    update_cmd: {
      description: "Shell command to refresh an existing install. Null or absent falls back to git pull plus install_cmd.",
      cliFlag: "--update-cmd <cmd>",
      cliDescription: "Update command. Defaults to git pull plus install_cmd when omitted",
    },
  },
  hook: {
    name: {
      description: "Kebab-case unique identifier for plan and results output.",
    },
    stage: {
      description: "Hook stage. v1 supports post-repos.",
    },
    cmd: {
      description: "Shell command to run after the repo stage.",
      cliFlag: "--cmd <cmd>",
      cliDescription: "Shell command to run during sync",
    },
    cwd: {
      description: "Relative path under the bound dotfiles repo.",
      cliFlag: "--cwd <path>",
      cliDescription: "Relative path under the bound dotfiles repo where the hook runs",
    },
    interactive: {
      description: "Whether the hook runs with a real terminal attached.",
      cliFlag: "--interactive",
      cliDescription: "Run the hook with a real terminal attached",
    },
    platforms: {
      description: "Array of platform names. Absent means all platforms.",
      cliFlag: "--platforms <list>",
      cliDescription: "Comma-separated platform list (win32,darwin,linux)",
    },
    profiles: {
      description: "Array of declared profile names. Absent means shared across all profiles.",
      cliFlag: "--profiles <list>",
      cliDescription: "Comma-separated profile list declared in marshal.json",
    },
  },
} as const satisfies Record<ManifestItemKind, Record<string, ManifestFieldDoc>>;

export function cliField(kind: ManifestItemKind, field: string): Required<Pick<ManifestFieldDoc, "cliFlag" | "cliDescription">> {
  const docsByKind: Record<ManifestItemKind, Record<string, ManifestFieldDoc>> = ManifestFieldDocs;
  const doc = docsByKind[kind][field];
  if (!doc?.cliFlag || !doc.cliDescription) {
    throw new Error(`No CLI help metadata for ${kind}.${field}`);
  }
  return {
    cliFlag: doc.cliFlag,
    cliDescription: doc.cliDescription,
  };
}

const PlatformSchema = z.enum(SUPPORTED_PLATFORMS as unknown as [string, ...string[]]);
const ProfileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "profile must be alphanumeric/hyphen");

const AppSchema = z.object({
  id: z.string().min(1, "app.id required").describe(ManifestFieldDocs.app.id.description),
  platforms: z.array(PlatformSchema).optional().describe(ManifestFieldDocs.app.platforms.description),
  profiles: z.array(ProfileNameSchema).optional().describe(ManifestFieldDocs.app.profiles.description),
});

const RepoSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "repo.name must be alphanumeric/hyphen").describe(ManifestFieldDocs.repo.name.description),
  url: z.string().min(1, "repo.url required").describe(ManifestFieldDocs.repo.url.description),
  platforms: z.array(PlatformSchema).optional().describe(ManifestFieldDocs.repo.platforms.description),
  profiles: z.array(ProfileNameSchema).optional().describe(ManifestFieldDocs.repo.profiles.description),
  install_cwd: z.string().optional().describe(ManifestFieldDocs.repo.install_cwd.description),
  install_cmd: z.string().min(1).optional().describe(ManifestFieldDocs.repo.install_cmd.description),
  update_cmd: z.string().min(1).nullable().optional().describe(ManifestFieldDocs.repo.update_cmd.description),
});

const HookSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "hook.name must be alphanumeric/hyphen").describe(ManifestFieldDocs.hook.name.description),
  stage: z.literal("post-repos").describe(ManifestFieldDocs.hook.stage.description),
  cmd: z.string().min(1, "hook.cmd required").describe(ManifestFieldDocs.hook.cmd.description),
  cwd: z.string().optional().describe(ManifestFieldDocs.hook.cwd.description),
  interactive: z.boolean().optional().default(false).describe(ManifestFieldDocs.hook.interactive.description),
  platforms: z.array(PlatformSchema).optional().describe(ManifestFieldDocs.hook.platforms.description),
  profiles: z.array(ProfileNameSchema).optional().describe(ManifestFieldDocs.hook.profiles.description),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  reposPath: z.string().optional(),
  profiles: z.array(ProfileNameSchema).default([]),
  apps: z.array(AppSchema).default([]),
  repos: z.array(RepoSchema).default([]),
  hooks: z.array(HookSchema).default([]),
}).superRefine((m, ctx) => {
  const seenProfiles = new Set<string>();
  m.profiles.forEach((profile, i) => {
    if (seenProfiles.has(profile)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles", i],
        message: `duplicate profile: ${profile}`,
      });
    }
    seenProfiles.add(profile);
  });
  const validateProfiles = (
    profiles: string[] | undefined,
    pathPrefix: Array<string | number>,
  ): void => {
    if (!profiles) {
      return;
    }
    profiles.forEach((profile, i) => {
      if (!seenProfiles.has(profile)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...pathPrefix, "profiles", i],
          message: `unknown profile: ${profile}`,
        });
      }
    });
  };
  m.apps.forEach((a, i) => validateProfiles(a.profiles, ["apps", i]));
  const seenRepos = new Set<string>();
  m.repos.forEach((r, i) => {
    validateProfiles(r.profiles, ["repos", i]);
    if (seenRepos.has(r.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repos", i, "name"],
        message: `duplicate repo name: ${r.name}`,
      });
    }
    seenRepos.add(r.name);
  });
  const seenHooks = new Set<string>();
  m.hooks.forEach((h, i) => {
    validateProfiles(h.profiles, ["hooks", i]);
    if (seenHooks.has(h.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hooks", i, "name"],
        message: `duplicate hook name: ${h.name}`,
      });
    }
    seenHooks.add(h.name);
    if (!h.cwd) {
      return;
    }
    if (isAbsolute(h.cwd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hooks", i, "cwd"],
        message: "hook.cwd must be relative to the bound dotfiles repo",
      });
      return;
    }
    const segments = normalize(h.cwd)
      .split(/[\\/]+/)
      .filter(Boolean);
    if (segments.includes("..")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hooks", i, "cwd"],
        message: "hook.cwd cannot escape the bound dotfiles repo",
      });
    }
  });
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type App = z.infer<typeof AppSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Hook = z.infer<typeof HookSchema>;

export class ManifestError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "ManifestError";
  }
}

// Read and validate marshal.json from the given dotfiles repo directory.
// Throws ManifestError with a useful message on any failure (missing file,
// invalid JSON, schema violation).
export function readManifest(dotfilesRepo: string): Manifest {
  const path = join(dotfilesRepo, MANIFEST_FILENAME);
  if (!existsSync(path)) {
    throw new ManifestError(`No ${MANIFEST_FILENAME} found at ${path}`, path);
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ManifestError(`Cannot read ${path}: ${(err as Error).message}`, path);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(`Invalid JSON in ${path}: ${(err as Error).message}`, path);
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ManifestError(`Invalid ${MANIFEST_FILENAME}:\n${issues}`, path);
  }
  return result.data;
}

// Schema-validate a JS object as a Manifest. Returns the parsed value or
// throws ManifestError. Used by `init` to validate before writing.
export function validateManifest(obj: unknown): Manifest {
  const result = ManifestSchema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ManifestError(`Invalid manifest:\n${issues}`);
  }
  return result.data;
}
