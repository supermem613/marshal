# Manifest format

Marshal reads two JSON files:

- `marshal.json` lives at the root of your **dotfiles repo**. It declares what apps and tools belong on a machine. One file, version-controlled, shared across machines.
- `~/.marshal.json` lives in your **home directory** on each machine. It records which dotfiles repo this machine is bound to. One file per machine, never committed.

---

## The `marshal.json` manifest

Single source of truth for what apps and tools a machine should have. Items are shared by default; add `profiles` when an app, repo, or hook should apply only to specific machine profiles.

```jsonc
{
  "version": 1,
  "reposPath": "~/repos",            // optional; default ~/repos. Tool repos cloned to <reposPath>/<name>.
  "profiles": ["work-laptop", "personal-desktop"],  // optional declared profile names

  "apps": [                           // winget package IDs (Windows)
    { "id": "Git.Git" },
    { "id": "OpenJS.NodeJS.LTS", "profiles": ["work-laptop", "personal-desktop"] },
    { "id": "dandavison.delta" },
    { "id": "Microsoft.DotNet.SDK.9", "platforms": ["win32"], "profiles": ["work-laptop"] }
  ],

  "repos": [
    {
      "name": "tool-alpha",                          // kebab-case identifier, must be unique
      "url": "https://github.com/me/tool-alpha.git",
      "platforms": ["win32", "darwin"],              // optional; absent = all platforms
      "profiles": ["work-laptop"],                   // optional; absent = shared across all profiles
      "install_cmd": "npm install && npm run build && npm link",
      "update_cmd": "tool-alpha update"              // optional; null/missing → falls back to git pull + install_cmd
    },
    {
      "name": "tool-suite",
      "url": "https://github.com/me/tool-suite.git",
      "install_cwd": "cli",                          // monorepo subfolder
      "install_cmd": "npm install && npm run build && npm link",
      "update_cmd": "tool-suite update"
    },
    {
      "name": "scripts",
      "url": "https://github.com/me/scripts.git"    // no install_cmd → clone/pull only
    },
    {
      "name": "desktop-tool",
      "url": "https://github.com/me/desktop-tool.git",
      "platforms": ["win32"],
      "install_cmd": "./build.ps1"
    }
  ],

  "hooks": [
    {
      "name": "config-sync",
      "stage": "post-repos",
      "cmd": "configsync sync",
      "profiles": ["work-laptop", "personal-desktop"],
      "interactive": true
    }
  ]
}
```

### Field reference

**Top level:**

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `version` | ✅ | — | Must be `1`. |
| `reposPath` | | `~/repos` | Where tool repos are cloned. Tilde expansion supported. |
| `profiles` | | `[]` | Declared profile names. Any item-level profile must appear here. |
| `apps` | | `[]` | Winget packages installed before any repos. |
| `repos` | | `[]` | Tool repos cloned, built, and updated. |
| `hooks` | | `[]` | Extra sync steps. v1 supports post-repo hooks such as `configsync sync`. |

**Per-app entry (`apps[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `id` | ✅ | Winget package identifier (e.g. `Git.Git`, `OpenJS.NodeJS.LTS`, `dandavison.delta`). |
| `platforms` | | Array of `win32` / `darwin` / `linux`. Absent = all platforms. |
| `profiles` | | Array of declared profile names. Absent = shared across all profiles. |

**Per-repo entry (`repos[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ | Kebab-case unique identifier. Becomes the folder name under `reposPath`. |
| `url` | ✅ | Clonable URL (any form `git clone` accepts). |
| `platforms` | | Same as apps. |
| `profiles` | | Same as apps. |
| `install_cwd` | | Subdirectory inside the cloned repo where `install_cmd` and `update_cmd` run. Defaults to the repo root. Use this for monorepos (for example, when the CLI lives under `cli/`). |
| `install_cmd` | | Shell command to build/install the tool. Runs on first clone and after pulls. If absent, marshal clones/pulls only — no build step. |
| `update_cmd` | | Shell command to refresh an existing install. If present, marshal runs *only* this on subsequent syncs. If absent or `null`, marshal runs `git pull --ff-only` and re-runs `install_cmd` (if set). |

**Per-hook entry (`hooks[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ | Kebab-case unique identifier for plan/results output. |
| `stage` | ✅ | Must be `"post-repos"` in v1. |
| `cmd` | ✅ | Shell command to run after the repo stage. |
| `interactive` | | `true` gives the child a real terminal. Use this for commands like `configsync sync`. Defaults to `false`. |
| `cwd` | | Relative path under the bound dotfiles repo. Defaults to the dotfiles repo root. |
| `platforms` | | Same as apps and repos. |
| `profiles` | | Same as apps and repos. |

### Profile filtering

Profiles let one dotfiles repo serve multiple machine shapes. Declare the allowed names once at the top level, then put `profiles` on the items that are not shared:

```jsonc
{
  "version": 1,
  "profiles": ["work-laptop", "personal-desktop"],
  "apps": [
    { "id": "Git.Git" },
    { "id": "Corp.VPN", "profiles": ["work-laptop"] }
  ],
  "repos": [
    { "name": "shared-tool", "url": "https://github.com/me/shared-tool.git" },
    { "name": "internal-tool", "url": "https://github.com/me/internal-tool.git", "profiles": ["work-laptop"] }
  ]
}
```

Rules:

- Items without `profiles` apply to every profile.
- Items with `profiles` apply only when the machine's active profile matches one of the listed names.
- Profile names are validated. Typos fail instead of silently skipping tools.
- Marshal does not infer profile from hostname and does not store machine-name mappings in `marshal.json`.
- If any profile-scoped item exists and no active profile is set, `marshal sync` fails with a fix-it message instead of applying a partial or empty plan.

### Sync action selection

For each repo applicable to the current platform, marshal picks one action:

| Repo dir on disk | `update_cmd` | `install_cmd` | Action |
|------------------|--------------|---------------|--------|
| Doesn't exist | — | present | `git clone` + `install_cmd` (in `install_cwd`) |
| Doesn't exist | — | absent | `git clone` only |
| Exists | present | — | `update_cmd` (in `install_cwd`) |
| Exists | absent / `null` | present | `git pull --ff-only` + `install_cmd` |
| Exists | absent / `null` | absent | `git pull --ff-only` only |

### Hook execution

- Hooks run only on a full `marshal sync`.
- `marshal sync <repo...>` skips hooks by default; pass `--hooks` to opt back in.
- Hooks run only after the repo stage succeeds. If any repo step fails, marshal records each hook as skipped and does not launch it.
- Interactive hooks are previewed in the plan before confirmation.

### App execution

- Apps are installed during `marshal sync` before any repo steps run.
- Marshal first checks `winget list --exact --id <app>` and only runs `winget install --exact --id <app>` when the package is missing.
- Re-running `marshal sync` is safe: already-installed apps short-circuit before install, and install-time "already installed" responses are still treated as success.

### Repo execution

- Repos are provisioned during `marshal sync`.
- If a repo's target directory does not exist yet, marshal detects that state and runs clone + install automatically.
- If an existing repo without `update_cmd` reports `Already up to date.` from `git pull --ff-only`, marshal skips the follow-up install/build command.
- `marshal status` shows applicable-but-not-yet-provisioned repos as `missing` so the next action is obvious.

### Platform filtering

Apps and repos with no `platforms` field apply to every platform. With one or more platforms listed, the row applies only when the current platform is in the list. Marshal is Windows-first today; the schema accepts `darwin` and `linux` for forward compatibility.

---

## The `~/.marshal.json` binding

Per-machine global config. One file, one source of truth — no env vars, no walk-up-tree discovery.

```jsonc
{
  "version": 1,
  "dotfilesRepo": "C:/Users/you/repos/dotfiles",
  "profile": "work-laptop"
}
```

Manage with:

```pwsh
marshal bind <url-or-path>     # set / re-bind
marshal bind --show            # print current binding
marshal bind --unset           # forget binding
marshal where                  # print just the path (one line, scriptable)
marshal profile set work-laptop
marshal profile get
marshal profile list
marshal profile clear
```

The binding refuses to point at a directory that doesn't contain a `marshal.json`, so you can't accidentally bind to a non-marshal repo.

`profile` is optional for legacy manifests. Once the manifest contains profile-scoped items, set it with `marshal profile set <name>` before syncing. Re-binding preserves the existing local profile; sync re-validates it against the newly bound manifest.

### Multiple machines

The binding is per-machine. Each machine binds independently — your dotfiles repo can live at `C:\Users\you\repos\dotfiles` on one box and `~/work/dotfiles` on another with no coordination.

Profiles are also per-machine. The shared manifest declares valid profile names and item membership; each machine stores only its selected profile in `~/.marshal.json`.
