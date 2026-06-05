# Feature: chat-ui preprocessed dist, workspace-clean (Branch A, reworks #246)

## Objective
Ship a `svelte-package`-preprocessed `dist` for `@sentropic/chat-ui` so EXTERNAL npm consumers get `.svelte` with TS stripped (fixes mermaid's postcss 500). exports→dist already done on this branch; the FAILURE is that workspace consumers (svelte-check `ui`, `build:ext`, `cowork-desktop` tsc) resolve via exports→dist but dist isn't built in the workspace. FIX = keep the workspace on `src` by overriding resolution in BOTH tools (vite + TypeScript), so dist is published-only. See `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §10 Branch A.

## Scope / Guardrails
- Make-only; ENV last; worktree `tmp/chatui-package-dist`; never `ENV=dev`; never `make clean-all`.
- Workspace stays on `src` (zero behaviour/HMR change); `dist` is for external npm only, built at publish.
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `ui/tsconfig.json` (add `paths` for `@sentropic/chat-ui/*` → src)
  - `packages/cowork-desktop/tsconfig.json` (same paths override)
  - `ui/vite.config.ts` (alias already present — verify it covers all subpaths)
  - the `build:ext` (and `build:vscode-ext` if it consumes chat-ui) vite config — add the same alias if it's a SEPARATE config
  - `BRANCH.md`
- **Conditional (declare BR-A-EXn)**: `Makefile` only if a target ordering genuinely needs it (prefer NOT to).
- **Forbidden**: `packages/chat-ui/src/**`, `.github/**`, `docker-compose*.yml`, `.cursor/**`, `api/**`. Do NOT reintroduce build-tool devDeps in `packages/chat-ui/package.json` (keeps lockfile in sync — they're installed ephemerally by `build-chat-ui`).

## Feedback Loop
- none

## AI Flaky tests
- e2e flaky across groups — re-run, don't chase.

## Orchestration Mode
- [x] Mono-branch + cherry-pick
- Rationale: complete the resolution overrides for one packaging change.

## Plan / Todo
- [x] **Lot 0 — Reproduce + locate**
  - [x] Worktree on `feat/chatui-package-dist`; ENV `feat-chatui-pkg`; ports API 9315 UI 5415 MAILDEV 1315.
  - [x] Read the failing resolutions: `ui/tsconfig.json`, `packages/cowork-desktop/tsconfig.json`, `ui/vite.config.ts` (existing alias), and find which config `npm run build:ext` (and `build:vscode-ext`) uses (grep `ui/package.json` scripts + any `vite.*.config.*`). Confirm chat-ui import sites that broke (e.g. `client/streamHub`, `stores/chatWidgetLayout`).
- [x] **Lot 1 — Override resolution to src (vite + TS)**
  - [x] `ui/tsconfig.json`: add `compilerOptions.paths` `"@sentropic/chat-ui": ["../packages/chat-ui/src/index.ts"]` + `"@sentropic/chat-ui/*": ["../packages/chat-ui/src/*"]` (match the actual relative path; svelte-check honours tsconfig paths).
  - [x] `packages/cowork-desktop/tsconfig.json`: same `paths` override (relative to its dir).
  - [x] Ensure `build:ext` (+ vscode-ext) resolves chat-ui → `../packages/chat-ui/src` (add the alias to its vite config if separate from `ui/vite.config.ts`).
  - [x] Verify the published surface is unaffected: exports stay →dist; `files:["dist"]`; version 0.11.0.
- [x] **Lot N — Gate (ALL must pass; these are the CI jobs that failed)**
  - [x] `make typecheck-lint-ui ENV=feat-chatui-pkg` (svelte-check resolves src)
  - [x] `make build-ui ENV=feat-chatui-pkg` (incl. `build:ext`)
  - [x] `make build-ui-image ENV=feat-chatui-pkg`
  - [x] `make validate-cowork-desktop ENV=feat-chatui-pkg` (tsc resolves src)
  - [x] `make typecheck-chat-ui` + `make build-chat-ui ENV=feat-chatui-pkg` (svelte-package dist) + `make pack-chat-ui ENV=feat-chatui-pkg` (dist sanity: no lang=ts)
  - [x] `make test-chat-ui ENV=test-chatui-pkg` + `make test-chat-ui-dom ENV=test-chatui-pkg`
  - [x] `make down ENV=feat-chatui-pkg`
  - [ ] Push; PR CI green (rerun e2e flakes). On merge, publish-chat-ui (decoupled) publishes consumable 0.11.0.
  - [ ] Remove BRANCH.md, push, merge.
