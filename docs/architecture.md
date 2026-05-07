# Architecture

## 🧠 Design principles

- **Plan → preview → confirm → apply** for every state-mutating command. Silent auto-apply is the anti-pattern that nearly torpedoed rotunda's first-sync UX.
- **Idempotent.** Re-running `sync` after a partial failure picks up where it stopped. Apps short-circuit when `winget list` shows they are already installed, and install-time "already installed" responses are still treated as success.
- **Failures don't cascade.** One failed repo install doesn't abort the rest of `sync`. You see every failure in one run.
- **Interactive hooks are explicit.** Commands like `rotunda sync` live in manifest hooks, are previewed before apply, and run only after the repo stage succeeds.
- **Marshal eats its own dogfood.** Marshal lives in its own `marshal.json` as a row, so `marshal sync` updates marshal alongside everything else.
- **Lean deps.** Three runtime deps: `chalk`, `commander`, `zod`. Every additional dep is a code-review conversation.
- **`--json` everywhere.** Any command producing output supports `--json` for scriptable consumption (`status`, `list`, `doctor`).
- **One source of truth.** Binding lives in exactly one place (`~/.marshal.json`). No env-var fallback, no walk-up-tree discovery — predictable across shells, terminals, IDEs, CI.

---

## 🛠️ Module layout

| Module | Responsibility |
|--------|----------------|
| `src/cli.ts` | Commander wiring; one entry point. |
| `src/context.ts` | `MarshalContext` — single dependency-injection seam (`homeDir`, `runner`, `log`, `prompt`, `platform`, `marshalSourceDir`). |
| `src/manifest.ts` | `marshal.json` zod schema + parsing, including sync hooks. |
| `src/binding.ts` | `~/.marshal.json` read/write/clear. |
| `src/platform.ts` | Platform detection and per-row platform filtering. |
| `src/paths.ts` | `~` expansion, default `reposPath`, absolute resolution. |
| `src/url.ts` | URL-vs-path detection (scheme-prefix only — Windows paths stay paths). |
| `src/plan.ts` | Pure function: `manifest + platform → Plan { apps, repos, hooks, actions }`. |
| `src/apply.ts` | Sequential plan executor with per-step pass/fail capture, including interactive hooks. |
| `src/render.ts` | Plan + result rendering (logger-pluggable). |
| `src/runners/` | `RealProcessRunner` (`shell:true` for Windows .cmd shims) + `MockProcessRunner` (string/regex matchers, fail injection). |
| `src/ui/` | `ConsoleLogger` + `CaptureLogger`; `StdinPrompter` + `CannedPrompter`. |
| `src/commands/` | One file per CLI command. `add.ts` owns repo/app/hook manifest mutation plus repo removal. Each takes `MarshalContext` first; returns exit code. |

The injectable `MarshalContext` makes every command unit-testable without touching real processes, the real filesystem, or stdin.

---

## 📐 Project structure

```
src/
  cli.ts                  Entry point — Commander program
  context.ts              MarshalContext (DI seam)
  manifest.ts             marshal.json schema (zod)
  binding.ts              ~/.marshal.json read/write
  platform.ts             Platform detection + filter
  paths.ts                ~ expansion, default reposPath
  url.ts                  URL-vs-path detection
  plan.ts                 Pure function: manifest → Plan
  apply.ts                Sequential plan executor
  render.ts               Plan + result rendering
  runners/
    types.ts              ProcessRunner interface, ExecResult, ProcessError
    real.ts               RealProcessRunner (shell:true on Windows)
    mock.ts               MockProcessRunner (test mock)
  ui/
    log.ts                ConsoleLogger + CaptureLogger
    prompt.ts             StdinPrompter + CannedPrompter
  commands/
    bind.ts               URL or path; --show / --unset / --no-sync
    init.ts               Create marshal.json + record binding
    sync.ts               Plan → preview → confirm → apply
    status.ts             Machine state report (+ --json)
    list.ts               Full manifest dump (+ --json)
    doctor.ts             Env + binding + manifest checks (+ --json)
    add.ts                Add or remove tool rows
    update.ts             Self-update
    cd.ts                 Cd / home subshells
    where.ts              Print bound dotfiles path
test/
  run.mjs                 Cross-platform test runner (HOME-sandboxed)
  helpers.ts              makeContext / makeDotfilesRepo / stubInstalledRepo
  unit/                   *.test.ts — pure-function units
  integration/            *.test.ts — command-function integration via mocks
```

---

## 🆚 vs. ad-hoc shell scripts

| | `install.sh` + `update.sh` (the old way) | marshal |
|---|---|---|
| Cold-start | Multi-step, per-machine drift | One command (`marshal bind <url>`) |
| Daily refresh | One bash + one PowerShell to maintain | Single TS codebase |
| Add a tool | Edit two scripts | One row in `marshal.json` |
| Doctor / status / dry-run | Build it yourself | Built in |
| Cross-platform | PS + bash duplication | Single source, platform filtering per row |
| Reusable for others | No | Yes (rotunda-shaped) |
