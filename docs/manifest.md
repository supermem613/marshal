# Manifest format

Marshal reads two JSON files:

- `marshal.json` lives at the root of your **dotfiles repo**. It declares what apps and tools belong on a machine. One file, version-controlled, shared across machines.
- `~/.marshal.json` lives in your **home directory** on each machine. It records which dotfiles repo this machine is bound to. One file per machine, never committed.

---

## The `marshal.json` manifest

Single source of truth for what apps and tools a machine should have.

```jsonc
{
  "version": 1,
  "reposPath": "~/repos",            // optional; default ~/repos. Tool repos cloned to <reposPath>/<name>.

  "apps": [                           // winget package IDs (Windows)
    { "id": "Git.Git" },
    { "id": "OpenJS.NodeJS.LTS" },
    { "id": "dandavison.delta" },
    { "id": "Microsoft.DotNet.SDK.9", "platforms": ["win32"] }
  ],

  "repos": [
    {
      "name": "tool-alpha",                          // kebab-case identifier, must be unique
      "url": "https://github.com/me/tool-alpha.git",
      "platforms": ["win32", "darwin"],              // optional; absent = all platforms
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
| `apps` | | `[]` | Winget packages installed before any repos. |
| `repos` | | `[]` | Tool repos cloned, built, and updated. |
| `hooks` | | `[]` | Extra sync steps. v1 supports post-repo hooks such as `configsync sync`. |

**Per-app entry (`apps[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `id` | ✅ | Winget package identifier (e.g. `Git.Git`, `OpenJS.NodeJS.LTS`, `dandavison.delta`). |
| `platforms` | | Array of `win32` / `darwin` / `linux`. Absent = all platforms. |

**Per-repo entry (`repos[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ | Kebab-case unique identifier. Becomes the folder name under `reposPath`. |
| `url` | ✅ | Clonable URL (any form `git clone` accepts). |
| `platforms` | | Same as apps. |
| `install_cwd` | | Subdirectory inside the cloned repo where `install_cmd` and `update_cmd` run. Defaults to the repo root. Use this for monorepos (for example, when the CLI lives under `cli/`). |
| `install_cmd` | ✅ | Shell command to build/install the tool. Runs on first clone. Convention: `npm install && npm run build && npm link`. |
| `update_cmd` | | Shell command to refresh an existing install. If present, marshal runs *only* this on subsequent syncs. If absent or `null`, marshal runs `git pull --ff-only` and re-runs `install_cmd`. |

**Per-hook entry (`hooks[]`):**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ | Kebab-case unique identifier for plan/results output. |
| `stage` | ✅ | Must be `"post-repos"` in v1. |
| `cmd` | ✅ | Shell command to run after the repo stage. |
| `interactive` | | `true` gives the child a real terminal. Use this for commands like `configsync sync`. Defaults to `false`. |
| `cwd` | | Relative path under the bound dotfiles repo. Defaults to the dotfiles repo root. |
| `platforms` | | Same as apps and repos. |

### Sync action selection

For each repo applicable to the current platform, marshal picks one action:

| Repo dir on disk | `update_cmd` | Action |
|------------------|--------------|--------|
| Doesn't exist | — | `git clone` + `install_cmd` (in `install_cwd`) |
| Exists | present | `update_cmd` (in `install_cwd`) |
| Exists | absent / `null` | `git pull --ff-only` + `install_cmd` |

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
  "dotfilesRepo": "C:/Users/you/repos/dotfiles"
}
```

Manage with:

```pwsh
marshal bind <url-or-path>     # set / re-bind
marshal bind --show            # print current binding
marshal bind --unset           # forget binding
marshal where                  # print just the path (one line, scriptable)
```

The binding refuses to point at a directory that doesn't contain a `marshal.json`, so you can't accidentally bind to a non-marshal repo.

### Multiple machines

The binding is per-machine. Each machine binds independently — your dotfiles repo can live at `C:\Users\you\repos\dotfiles` on one box and `~/work/dotfiles` on another with no coordination.
