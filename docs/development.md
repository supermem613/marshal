# Development

## 🧪 Build, test, lint

```pwsh
npm install                   # one-time
npm run build                 # eslint + tsc --noEmit (test) + tsc (emit)
npm run lint                  # eslint + tsc --noEmit src + tsc --noEmit test
npm test                      # all tests (HOME-sandboxed)
npm run test:unit             # unit only
npm run test:integration      # integration only
npm run clean                 # remove dist/
```

`npm run build` runs `prebuild` first, so ESLint failures and test type errors fail the build before emit.

CI runs the same `npm ci → npm run lint → npm test` sequence on a Windows runner — see `.github/workflows/ci.yml`.

---

## 🧰 Test conventions

- **HOME sandbox.** `HOME`, `USERPROFILE`, and `LOCALAPPDATA` are pointed at a tmpdir before any test runs (`test/run.mjs`). Tests cannot read or mutate the developer's real `~/.marshal.json`. Set `MARSHAL_TEST_REAL_HOME=1` to opt out.
- **Injectable context.** Integration tests construct a `MarshalContext` via `test/helpers.ts::makeContext()` with `MockProcessRunner` (string/regex matchers, optional fail injection), `CaptureLogger` (records every line), and `CannedPrompter` (returns answers in order). No real spawn, no real stdin, no real filesystem outside the sandbox.
- **TAP aggregation.** The runner aggregates per-file TAP into a single `# AGGREGATE: tests N | pass N | fail N` line per `npm test` invocation.

---

## 🔍 Audit (docs ↔ code coverage)

The repo ships an `.audit-repo.yaml` declaring `src/cli.ts` as the source of truth for the command surface and `docs/commands.md` as the doc target that must reflect it. To verify they stay in sync:

```pwsh
node ~/.copilot/skills/audit-repo/scripts/audit-docs.mjs --repo C:\Users\marcusm\repos\marshal
```

Exit codes: `0` clean, `1` findings, `2` script error.

Run after touching `src/cli.ts` or `docs/commands.md`. Add a stale-term entry to `.audit-repo.yaml` whenever you remove a command or flag — that's the only way the audit can catch lingering references in docs and skill files.

---

## 📦 Release / install conventions

Marshal is **not** published to npm. Install via clone + npm-link, same as `kash`, `rotunda`, `reflux`, `forge`, `uatu`:

```pwsh
git clone https://github.com/<you>/marshal.git ~/repos/marshal
cd ~/repos/marshal && npm install && npm run build && npm link
```

Self-update from anywhere thereafter: `marshal update` (which delegates to `git pull --ff-only && npm install && npm run build` in the source dir; the npm-link symlink persists).

---

## 🧾 Adding a new command

1. Drop `src/commands/<verb>.ts` exporting `<verb>Command(ctx, ...args, opts): Promise<number>`.
2. Wire it in `src/cli.ts` via `program.command("<verb>")...action(...)`. Register options + description.
3. Add a row to the `## 📋 Commands` table in `docs/commands.md`.
4. Add tests under `test/integration/<verb>.test.ts`.
5. Run `npm run build && npm test && node ~/.copilot/skills/audit-repo/scripts/audit-docs.mjs --repo .` — all three must be green.

---

## 🧱 Lean-dep ethos

Three runtime deps: `chalk`, `commander`, `zod`. Adding a fourth requires a code-review conversation. Prefer Node built-ins (`node:fs`, `node:path`, `node:child_process`, `node:readline/promises`, `node:os`) over npm packages whenever feasible.
