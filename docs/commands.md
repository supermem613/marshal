# Commands

Full reference for every `marshal` subcommand. Run `marshal --help` for the same surface in your terminal, or `marshal <cmd> --help` for per-command flags.

## 📋 Commands

| Verb | Usage | Description |
|------|-------|-------------|
| `add` | `marshal add <url>` | Append one tool repo to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--name`, `--install-cmd`, `--update-cmd`, `--install-cwd`, `--platforms`, `--profiles`, `--sync`, `-y`. Manifest-field option help is read from the schema metadata. |
| `add-app` | `marshal add-app <id>` | Append one prerequisite app to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--platforms`, `--profiles`, `--sync`, `-y`. Manifest-field option help is read from the schema metadata. |
| `add-hook` | `marshal add-hook <name> --cmd "<cmd>"` | Append one sync hook to the manifest. Manifest-only by default; pass `--sync` to apply immediately. Flags: `--cwd`, `--interactive`, `--platforms`, `--profiles`, `--sync`, `-y`. Manifest-field option help is read from the schema metadata. |
| `bind` | `marshal bind <url\|path>` | Bind to a dotfiles repo. URLs auto-clone + provision; paths just record the binding. Flags: `--path <p>`, `--show`, `--unset`, `--no-sync`, `-y`. |
| `cd` | `marshal cd` | Spawn a subshell rooted at the bound dotfiles repo (like `chezmoi cd`). |
| `doctor` | `marshal doctor` | Health check: Node version, git, winget (Win32), binding, manifest. `--json` supported. |
| `home` | `marshal home` | Spawn a subshell rooted at the marshal source repo. |
| `init` | `marshal init` | Create a minimal `marshal.json` in the current directory and record the binding. `--no-bind` to skip binding. |
| `list` | `marshal list` | Print the full manifest contents (apps, repos, hooks, with platform filters). `--json` supported. |
| `profile` | `marshal profile [list|get|set|clear|add|remove|scope|unscope] ...` | Manage declared manifest profiles, item profile scopes, and the machine-local active profile stored in `~/.marshal.json`. Manifest-editing actions support `-y`. |
| `remove` | `marshal remove <repo>` | Remove one tool repo from the manifest and delete the cloned directory. `--keep-files` to preserve the clone. `-y` to skip confirmation. |
| `remove-app` | `marshal remove-app <id>` | Remove one prerequisite app from the manifest. `-y` to skip confirmation. |
| `remove-hook` | `marshal remove-hook <name>` | Remove one sync hook from the manifest. `-y` to skip confirmation. |
| `status` | `marshal status` | Show what's recorded, what applies to this platform, and what's installed. `--json` for machine output. |
| `sync` | `marshal sync [repos...]` | Apply the manifest: install apps, clone/build/refresh repos, then run configured hooks. Optionally limit to named tools. Flags: `-y`, `--hooks`, `--profile <name>` one-shot override. |
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
# no install_cmd → clone/pull only
```

Until you run `marshal sync`, the new repo shows up as `missing` in `marshal status`.

Override the install behavior:

```pwsh
marshal add https://github.com/<you>/desktop-tool.git \
  --install-cmd "./build.ps1" \
  --platforms win32 \
  --profiles work-laptop
marshal sync
```

Add prerequisites and hooks without editing JSON:

```pwsh
marshal add-app Git.Git -y
marshal add-app OpenJS.NodeJS.LTS -y
marshal add-app dandavison.delta -y
marshal add-app Microsoft.DotNet.SDK.9 --platforms win32 -y
marshal add-hook config-sync --cmd "configsync sync" --interactive -y
marshal add-hook prompt-sync --cmd "prompt sync" --interactive -y
marshal sync
```

### Machine profiles

Profiles let one dotfiles repo contain shared items and machine-specific items.

```pwsh
marshal profile add work-laptop -y
marshal profile list
marshal profile set work-laptop
marshal profile get
marshal sync
```

`marshal.json` declares valid profile names. `marshal profile add <name>` appends a declared profile to the shared manifest, while `marshal profile set <name>` writes the selected profile to `~/.marshal.json`, validates the name, and keeps machine identity out of the shared manifest. Items without a `profiles` field are shared across all profiles; items with `profiles` are included only when the active profile matches.

Change existing item scopes without hand-editing JSON:

```pwsh
marshal profile scope app work-laptop Git.Git OpenJS.NodeJS.LTS -y
marshal profile scope repo work-laptop forge marshal -y
marshal profile scope hook work-laptop config-sync prompt-sync -y
marshal profile unscope app work-laptop Git.Git OpenJS.NodeJS.LTS -y
marshal profile remove work-laptop -y
```

`scope` and `unscope` accept `app`, `repo`, or `hook` as the item kind, then a profile name, then one or more item names. Removing the last profile from an item makes that item shared across all profiles. `profile remove <name>` refuses while any item still references that profile, so removing a declared profile cannot accidentally make profile-only items global.

Use `marshal sync --profile <name>` for a one-shot override without changing `~/.marshal.json`.

### Removing a tool

```pwsh
marshal remove newtool                # also deletes ~/repos/newtool/
marshal remove tool-alpha --keep-files
marshal remove tool-beta --keep-files
marshal remove-app Git.Git
marshal remove-app OpenJS.NodeJS.LTS
marshal remove-hook config-sync
marshal remove-hook prompt-sync
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
