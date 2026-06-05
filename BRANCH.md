# Feature: chat-ui publish-only preprocessed dist (Z2 pivot)

## Objective
Produce a preprocessed `dist` tarball for `@sentropic/chat-ui@0.11.0` published to npm, while the repo workspace keeps consuming chat-ui SOURCE exactly as on `main` (zero overrides, all workspace jobs green). The dist-form `exports`/`files` exist only in the published npm tarball, produced by a transient package.json rewrite at pack/publish time.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/` and `Makefile` (BR-PKG-EX1 for Makefile).
- Workspace config files (`ui/vite.config.ts`, `ui/tsconfig.json`, `packages/cowork-desktop/tsconfig.json`, `ui/chrome-ext/vite.config.ext.ts`, `ui/vscode-ext/vite.webview.config.ts`) fully reverted to main state.
- No build-tool devDeps added to `packages/chat-ui/package.json`.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chatui-package-dist`.
- ENV `feat-chatui-pkg`; ports API_PORT=9315 UI_PORT=5415 MAILDEV_UI_PORT=1315.
- Tests: `ENV=test-chatui-pkg`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/svelte.config.js`
  - `packages/chat-ui/scripts/make-publish-pkgjson.mjs`
  - `packages/chat-ui/tests/chat-conversation.spec.ts`
  - `Makefile` (BR-PKG-EX1)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/vite.config.ts`
  - `ui/tsconfig.json`
  - `packages/cowork-desktop/tsconfig.json`
  - `ui/chrome-ext/vite.config.ext.ts`
  - `ui/vscode-ext/vite.webview.config.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - **BR-PKG-EX1**: Makefile `pack-chat-ui` and `publish-chat-ui` (and `publish-chat-ui-token`) targets updated to add transient package.json rewrite logic (node script invocation + backup/restore). Rationale: the transient rewrite cannot happen without Makefile targets knowing about it. Impact: only `build-chat-ui`, `pack-chat-ui`, `publish-chat-ui`, `publish-chat-ui-token` targets are changed. Rollback: revert Makefile hunk + delete `packages/chat-ui/scripts/make-publish-pkgjson.mjs`.

## Feedback Loop
- none

## AI Flaky tests
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single subagent, single test cycle)
- [ ] **Multi-branch**
- Rationale: Single orthogonal change (revert + pack-time rewrite); no independent subworkstreams.

## UAT Management (in orchestration context)
- Mono-branch: UAT performed on integrated branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch is `feat/chatui-package-dist`.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §10, `plan/BRANCH_TEMPLATE.md`.
  - [x] Understand Z2 pivot: repo stays on src, dist exists only in npm tarball.
  - [x] ENV mapping: `feat-chatui-pkg`, API_PORT=9315, UI_PORT=5415, MAILDEV_UI_PORT=1315.

- [x] **Lot 1 — Revert workspace-facing changes + update chat-ui for src-form**
  - [x] `git checkout origin/main -- ui/vite.config.ts ui/tsconfig.json packages/cowork-desktop/tsconfig.json ui/chrome-ext/vite.config.ext.ts ui/vscode-ext/vite.webview.config.ts`
  - [x] `packages/chat-ui/package.json`: reverted to main src-form, version kept at 0.11.0.
  - [x] `packages/chat-ui/export-manifest.json`: `_version` updated to 0.11.0 (structure stays src-based).
  - [x] `packages/chat-ui/tests/chat-conversation.spec.ts`: reverted to main form, version assertions updated to 0.11.0.
  - [x] `packages/chat-ui/tests/export-surface.spec.ts`: identical to main (no dist path mapping needed, package.json is src-form).
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` — PASS
    - [x] `make test-chat-ui ENV=test-chatui-pkg` — PASS (408 tests)
    - [x] `make test-chat-ui-dom ENV=test-chatui-pkg` — PASS (109 tests)

- [x] **Lot 2 — Publish-time dist rewrite (BR-PKG-EX1)**
  - [x] Create `packages/chat-ui/scripts/make-publish-pkgjson.mjs` — node script that rewrites package.json to dist-form in-place (with `--write`) and restores via trap in Makefile.
  - [x] Update `pack-chat-ui` Makefile target: run dist sanity check, then transiently rewrite package.json, run `npm pack --dry-run`, restore.
  - [x] Update `publish-chat-ui` Makefile target: transiently rewrite package.json, run `npm publish`, restore.
  - [x] Update `publish-chat-ui-token` Makefile target: same restore pattern.
  - [x] Lot gate:
    - [x] `make build-chat-ui ENV=feat-chatui-pkg` — PASS (svelte-package dist)
    - [x] `make pack-chat-ui ENV=feat-chatui-pkg` — PASS (dist-form tarball, no lang=ts, exports→dist)
    - [x] `make typecheck-lint-ui ENV=feat-chatui-pkg` (= typecheck-ui + lint-ui) — PASS (0 errors)
    - [x] `make build-ui ENV=feat-chatui-pkg` — PASS
    - [x] `make build-ui-image ENV=feat-chatui-pkg` — PASS
    - [x] `make typecheck-cowork-desktop ENV=feat-chatui-pkg` — PASS
    - [x] validate-cowork-desktop (= typecheck + test + build + pack cowork-desktop) — PASS
    - [x] `make down ENV=feat-chatui-pkg` — PASS

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` created; spec context in `spec/SPEC_EVOL_CHATUI_FIDELITY.md` unchanged.

- [ ] **Lot N — Final validation**
  - [ ] Retest gates (copy of Lot 1+2).
  - [ ] Final gate: create PR using BRANCH.md as body.
  - [ ] CI green on PR.
  - [ ] Once UAT + CI OK: commit removal of BRANCH.md, push, merge.
