# marshal

> Bind to a dotfiles repo and provision your CLI tool fleet — clone, build, install, and update everything from one manifest.

Marshal is a generic, reusable fleet-management CLI. You point it at any dotfiles repo containing a `marshal.json`, and it handles the rest: install OS prerequisites (winget), clone your tool repos, build them, link them, and keep them up to date.

```
config manager → syncs agent config files between your machine and dotfiles
marshal → syncs agent tools between your machine and dotfiles
```

Both bind to the same dotfiles repo. Together they reproduce a machine.

---

## ⚡ Quick start

Cold-start, bare metal → manifest seeded → machine provisioned:

```pwsh
winget install Git.Git OpenJS.NodeJS.LTS dandavison.delta
git clone https://github.com/<you>/marshal.git ~/repos/marshal
cd ~/repos/marshal
npm install && npm run build && npm link

git clone https://github.com/<you>/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
marshal init --no-bind
marshal bind .

marshal add https://github.com/<you>/tool-alpha.git https://github.com/<you>/tool-beta.git -y
marshal add https://github.com/<you>/tool-suite.git --name suite --install-cwd cli -y
marshal add https://github.com/<you>/desktop-tool.git --install-cmd "./build.ps1" --platforms win32 -y

marshal add-app Git.Git OpenJS.NodeJS.LTS dandavison.delta -y
marshal add-app Microsoft.DotNet.SDK.9 --platforms win32 -y

marshal add-hook config-sync prompt-sync --cmd "configsync sync" --interactive -y

marshal profile add work-laptop -y
marshal profile set work-laptop   # optional; required when marshal.json has profile-scoped items
marshal profile scope hook work-laptop config-sync prompt-sync -y
marshal sync
```

That flow keeps onboarding simple:

1. Bind marshal to the customer dotfiles repo.
2. Add repos, prerequisites, and hooks with CLI commands instead of hand-editing JSON.
3. Set a machine profile when your manifest has profile-scoped items.
4. Run one `marshal sync` to install apps, provision repos, and run any configured hooks.

Prerequisites are not installed at `marshal add-app` time. They are installed on
the next `marshal sync`, and re-running `sync` is safe: marshal checks whether a
package is already installed before invoking `winget install`.
Likewise, newly added repos are not provisioned at `marshal add` time unless you pass
`--sync`; the next `marshal sync` detects that the repo is missing locally and clones + installs it.

---

## 📚 Documentation

| Topic | Document |
|-------|----------|
| Every command, every flag, with examples | [docs/commands.md](docs/commands.md) |
| `marshal.json` manifest schema and `~/.marshal.json` binding format | [docs/manifest.md](docs/manifest.md) |
| Module layout, design principles, project structure | [docs/architecture.md](docs/architecture.md) |
| Build, test, lint, audit workflows | [docs/development.md](docs/development.md) |

For a one-screen overview, run:

```pwsh
marshal --help
```

---

## 📄 License

[MIT](LICENSE)
