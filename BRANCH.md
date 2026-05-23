# Fix: NPM publish lanes bootstrap & refresh

## Objective
Align every `@sentropic/*` package with the npm registry: bootstrap-publish `chat-ui`, `chat-core`, `events`, `contracts` (never published), flip `flow` from private to public for first publish, bump `llm-mesh` `0.1.0 → 0.1.1` to ship the catalog corrections (gemini-flash, gemini-pro, opus-47, BR-14g) merged on main but never republished.

## Scope / Guardrails
- Scope limited to npm publish wiring (Makefile targets, CI lanes, package manifests).
- One-shot bootstrap via `NPM_TOKEN` secret; subsequent publishes run on OIDC trusted publishers (attached post-merge via npmjs UI, not in this branch).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-npm-publish`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/package.json`
  - `packages/chat-ui/package.json`
  - `packages/chat-core/package.json`
  - `packages/events/package.json`
  - `packages/contracts/package.json`
  - `packages/flow/package.json`
  - `package-lock.json` (regenerated from packages/* deps changes — root workspace lockfile)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BR-NPM-EX1)
  - `.github/workflows/ci.yml` (BR-NPM-EX2)

## Feedback Loop
- [ ] `acknowledge` BR-NPM-EX1: edit `Makefile` to add `publish-<pkg>` (OIDC) and `publish-<pkg>-token` (bootstrap NPM_TOKEN) targets for `chat-core`, `events`, `contracts`, `flow`. Reason: this branch's whole purpose is wiring publish lanes; impact: additive `.PHONY` targets only, no rewrite of existing rules; rollback: drop new targets.
- [ ] `acknowledge` BR-NPM-EX2: edit `.github/workflows/ci.yml` to add `paths` filters and `validate-<pkg>` + `publish-<pkg>` jobs for `chat-core`, `events`, `contracts`, `flow`, and a `workflow_dispatch` bootstrap input. Reason: required to mirror existing `publish-llm-mesh`/`publish-chat-ui` lanes for new packages; impact: additive jobs, no edit of existing lanes; rollback: drop new jobs.

## AI Flaky tests
- Not applicable (no model calls, no E2E runs in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: All changes are one logical operational fix in one tree; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: post-merge bootstrap workflow_dispatch + npm registry observation is the UAT.
- No browser UAT applicable.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/conductor.md`, `rules/subagents.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/fix-npm-publish`.
  - [x] Capture Makefile targets needed (`build-*`, `publish-*`, `publish-*-token`).
  - [x] Define environment mapping: slot 0 — `API_PORT=9110`, `UI_PORT=5310`, `MAILDEV_UI_PORT=1210`, `ENV=fix-npm-publish` last.
  - [x] Confirm command style: `make <target> API_PORT=9110 UI_PORT=5310 MAILDEV_UI_PORT=1210 ENV=fix-npm-publish`.
  - [x] Confirm scope and guardrails.
  - [x] Declare BR-NPM-EX1 + BR-NPM-EX2 above.
  - [x] Confirm `NPM_TOKEN` GitHub secret already set on `rhanka/sentropic` (created 2026-05-23, GAT `sentropic-bootstrap-publish`, `@sentropic` scope R/W, bypass 2FA, expires 2026-08-21).
  - [x] Confirm `@sentropic/llm-mesh` trusted publisher already migrated to `rhanka/sentropic / ci.yml` (done 2026-05-23 via npmjs UI).

- [x] **Lot 1 — Package manifest changes**

- [x] **Lot 1b — Cross-package deps version pinning**
  - [x] `packages/events/package.json`: `@sentropic/contracts: "*" → "^0.1.0"`.
  - [x] `packages/chat-core/package.json`: `@sentropic/{contracts,events}: "*" → "^0.1.0"` each.
  - [x] Lot gate:
    - [x] `git diff` shows only deps version pinning.
    - [x] `make commit MSG="fix(packages): pin @sentropic deps to ^0.1.0 (was *) for events/chat-core"`.
  - [x] `packages/llm-mesh/package.json`: bump `0.1.0 → 0.1.1`.
  - [x] `packages/flow/package.json`: flip `"private": true → false`, bump `0.0.0 → 0.1.0`, fields already aligned with `llm-mesh` reference.
  - [x] `packages/chat-ui/package.json`: kept `0.1.0`, `publishConfig.access=public` confirmed, repo URL already `sentropic.git`.
  - [x] `packages/chat-core/package.json`: kept `0.1.0`, `publishConfig.access=public` confirmed, fixed repo URL `entropic.git → sentropic.git`.
  - [x] `packages/events/package.json`: kept `0.1.0`, `publishConfig.access=public` confirmed, fixed repo URL `entropic.git → sentropic.git`.
  - [x] `packages/contracts/package.json`: kept `0.1.0`, `publishConfig.access=public` confirmed, fixed repo URL `entropic.git → sentropic.git`.
  - [x] Lot gate:
    - [x] `git diff packages/` shows version bumps + private flip + repo URL corrections, no spurious change.
    - [x] `make commit MSG="chore(packages): bump llm-mesh 0.1.1, unprivate flow, fix entropic→sentropic repo URLs"`.

- [ ] **Lot 2 — Makefile bootstrap + OIDC targets**
  - [ ] Mirror `publish-chat-ui` block from existing Makefile to add `publish-chat-core` (OIDC), `publish-events` (OIDC), `publish-contracts` (OIDC), `publish-flow` (OIDC).
  - [ ] Mirror `publish-chat-ui-token` block to add `publish-chat-core-token`, `publish-events-token`, `publish-contracts-token`, `publish-flow-token`.
  - [ ] Lot gate:
    - [ ] `make publish-chat-core --dry-run` (or `make -n publish-chat-core`) prints expected recipe without executing.
    - [ ] `git diff Makefile` shows only additive `.PHONY` blocks for new targets.
    - [ ] `make commit MSG="feat(make): add publish lanes for chat-core/events/contracts/flow"`.

- [ ] **Lot 3 — CI publish lanes**
  - [ ] In `.github/workflows/ci.yml`, extend `changes.outputs` to include `chat_core`, `events`, `contracts`, `flow` and add their `paths` filters (mirror `chat_ui` block).
  - [ ] Add `validate-chat-core`, `validate-events`, `validate-contracts`, `validate-flow` jobs (mirror `validate-chat-ui`).
  - [ ] Add `publish-chat-core`, `publish-events`, `publish-contracts`, `publish-flow` jobs (mirror `publish-chat-ui`, OIDC mode).
  - [ ] Add `workflow_dispatch` input `bootstrap_publish` (boolean) on the workflow; when true, run `make publish-<pkg>-token` instead of `make publish-<pkg>`, with `NPM_TOKEN_FILE` populated from `secrets.NPM_TOKEN`.
  - [ ] Lot gate:
    - [ ] `git diff .github/workflows/ci.yml` shows only additive filters + jobs + dispatch input.
    - [ ] yaml-lint via `make lint` if available, or visual review.
    - [ ] `make commit MSG="ci: add publish lanes for chat-core/events/contracts/flow + bootstrap dispatch"`.

- [ ] **Lot 4 — PR + CI green**
  - [ ] `git push origin fix/npm-publish` (no `--set-upstream`).
  - [ ] Create PR with `BRANCH.md` as body.
  - [ ] Verify CI green on this branch (no actual publish runs because lanes are gated on `github.ref == 'refs/heads/main'`).
  - [ ] Merge to main once green.

- [ ] **Lot 5 — Bootstrap publish via workflow_dispatch (post-merge)**
  - [ ] Trigger `workflow_dispatch` on `ci.yml` with `bootstrap_publish=true` on main, scoped first to a single package (`chat-ui`) to validate flow.
  - [ ] On success, verify `@sentropic/chat-ui@0.1.0` on registry.npmjs.org.
  - [ ] Repeat for `chat-core`, `events`, `contracts`, `flow`.
  - [ ] For `llm-mesh`, the normal lane will republish `0.1.1` automatically on the merge commit (paths filter matches the version bump).

- [ ] **Lot 6 — Attach OIDC trusted publishers (post-bootstrap, manual via npmjs UI)**
  - [ ] For each newly published package (`chat-ui`, `chat-core`, `events`, `contracts`, `flow`), open `https://www.npmjs.com/package/@sentropic/<pkg>/access` and add trusted publisher: GitHub Actions, `rhanka/sentropic`, workflow `ci.yml`, `npm publish` allowed.
  - [ ] Confirm CI run after a subsequent dummy commit on each `packages/<pkg>/` uses OIDC and not the token.

- [ ] **Lot 7 — Final validation & cleanup**
  - [ ] Run `npm view @sentropic/<pkg> version` for all 6 packages; confirm all show `0.1.0`+ (or `0.1.1` for llm-mesh).
  - [ ] Confirm next regular publish (e.g. a docs-only commit on `packages/llm-mesh/`) uses OIDC and not the token.
  - [ ] Remove `BRANCH.md`, push, ensure PR is merged.
  - [ ] Plan for `NPM_TOKEN` secret rotation/removal after 2026-08-21 (token expiry) — documented in PR description.
