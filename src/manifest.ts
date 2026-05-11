import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { SUPPORTED_PLATFORMS } from "./platform.js";

// `marshal.json` lives at the root of the dotfiles repo (sibling to
// `rotunda.json`). It is the single source of truth for what tools and apps
// a machine should have. Schema is intentionally small — every field earns
// its place.

export const MANIFEST_FILENAME = "marshal.json";

const PlatformSchema = z.enum(SUPPORTED_PLATFORMS as unknown as [string, ...string[]]);
const ProfileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "profile must be alphanumeric/hyphen");

const AppSchema = z.object({
  id: z.string().min(1, "app.id required"),
  platforms: z.array(PlatformSchema).optional(),
  profiles: z.array(ProfileNameSchema).optional(),
});

const RepoSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "repo.name must be alphanumeric/hyphen"),
  url: z.string().min(1, "repo.url required"),
  platforms: z.array(PlatformSchema).optional(),
  profiles: z.array(ProfileNameSchema).optional(),
  install_cwd: z.string().optional(),
  install_cmd: z.string().min(1).optional(),
  update_cmd: z.string().min(1).nullable().optional(),
});

const HookSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "hook.name must be alphanumeric/hyphen"),
  stage: z.literal("post-repos"),
  cmd: z.string().min(1, "hook.cmd required"),
  cwd: z.string().optional(),
  interactive: z.boolean().optional().default(false),
  platforms: z.array(PlatformSchema).optional(),
  profiles: z.array(ProfileNameSchema).optional(),
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
