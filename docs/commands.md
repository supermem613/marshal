# Commands

Full reference for every `marshal` subcommand. Run `marshal --help` for the same surface in your terminal, or `marshal <cmd> --help` for per-command flags.

## 📋 Commands

| Verb | Usage | Description |
|------|-------|-------------|
| `add` | `marshal add <url> [name]` | Append a tool repo to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--install-cmd`, `--update-cmd`, `--install-cwd`, `--platforms`, `--sync`, `-y`. |
| `add-app` | `marshal add-app <id>` | Append a prerequisite app to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--platforms`, `--sync`, `-y`. |
| `add-hook` | `marshal add-hook <name> --cmd "<cmd>"` | Append a sync hook to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--cwd`, `--interactive`, `--platforms`, `--sync`, `-y`. |
| `bind` | `marshal bind <url\|path>` | Bind to a dotfiles repo. URLs auto-clone + provision; paths just record the binding. Flags: `--path <p>`, `--show`, `--unset`, `--no-sync`, `-y`. |
| `cd` | `marshal cd` | Spawn a subshell rooted at the bound dotfiles repo (like `chezmoi cd`). |
| `doctor` | `marshal doctor` | Health check: Node version, git, winget (Win32), binding, manifest. `--json` supported. |
| `home` | `marshal home` | Spawn a subshell rooted at the marshal source repo. |
| `init` | `marshal init` | Create a minimal `marshal.json` in the current directory and record the binding. `--no-bind` to skip binding. |
| `list` | `marshal list` | Print the full manifest contents (apps, repos, hooks, with platform filters). `--json` supported. |
| `remove` | `marshal remove <name>` | Remove a tool from the manifest and delete its cloned directory. `--keep-files` to preserve the clone. `-y` to skip confirmation. |
| `status` | `marshal status` | Show what's recorded, what applies to this platform, and what's installed. `--json` for machine output. |
| `sync` | `marshal sync [repos...]` | Apply the manifest: install apps, clone/build/refresh repos, then run configured hooks. Optionally limit to named tools. Flags: `-y`, `--hooks`. |
| `update` | `marshal update` | Self-update marshal: `git pull --ff-only`, then `npm install && npm run build` only when the pull brings in new changes. |
| `where` | `marshal where` | Print the absolute path of the bound dotfiles repo. |

---

## 🔄 Typical workflows

### First machine

```pwsh
winget install Git.Git OpenJS.NodeJS.LTS dandavison.delta
git clone https://github.com/<you>/marshal.git ~/repos/marshal
cd ~/repos/marshal && npm install && npm run build && npm link
git clone https://github.com/<you>/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
marshal init --no-bind
marshal bind .
```

### Daily refresh on an existing machine

```pwsh
marshal sync           # interactive plan → confirm → apply
marshal sync -y        # skip confirmation
marshal sync tool-alpha      # only refresh the named tool
marshal sync rotunda --hooks   # targeted repo sync, then run configured hooks
```

`sync` is also when prerequisite apps are installed. Marshal first checks whether
each applicable `apps[]` entry is already installed, then runs `winget install`
only for missing packages. If the install path still reports "already installed",
marshal treats that as success.
For repos, `sync` detects any manifest entry whose clone target is missing locally
and provisions it automatically with clone + install. For existing repos without
an `update_cmd`, marshal skips the follow-up install command when `git pull --ff-only`
reports that the repo is already up to date.

### Adding a new tool

```pwsh
marshal add https://github.com/<you>/newtool.git
marshal sync
# uses default install_cmd: npm install && npm run build && npm link
```

Until you run `marshal sync`, the new repo shows up as `missing` in `marshal status`.

Override the install behavior:

```pwsh
marshal add https://github.com/<you>/desktop-tool.git \
  --install-cmd "./build.ps1" \
  --platforms win32
marshal sync
```

Add prerequisites and hooks without editing JSON:

```pwsh
marshal add-app Git.Git -y
marshal add-app OpenJS.NodeJS.LTS -y
marshal add-app dandavison.delta -y
marshal add-app Microsoft.DotNet.SDK.9 --platforms win32 -y
marshal add-hook config-sync --cmd "configsync sync" --interactive -y
marshal sync
```

### Removing a tool

```pwsh
marshal remove newtool                # also deletes ~/repos/newtool/
marshal remove newtool --keep-files
```

### Inspecting state

```pwsh
marshal status              # what should be installed vs what is
marshal status --json       # same, machine-readable
marshal list                # full manifest contents
marshal doctor              # environment + binding + manifest health
```

### Self-update marshal

```pwsh
marshal update              # git pull, then npm install + npm run build only when changes land
```

### Jump into the bound dotfiles repo

```pwsh
marshal cd                  # spawns a subshell at <dotfiles-repo>; `exit` returns
marshal home                # same, but rooted at the marshal source repo
```

---

## 🔗 Managing the binding

The binding (`~/.marshal.json`) records which dotfiles repo this machine is bound to. See [manifest.md](manifest.md#the-marshaljson-binding) for the file format.

```pwsh
marshal bind <url-or-path>     # set / re-bind
marshal bind --show            # print current binding
marshal bind --unset           # forget binding
marshal where                  # print just the path (one line, scriptable)
```
