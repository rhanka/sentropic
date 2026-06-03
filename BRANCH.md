# Feature: chat-ui no-orphan fidelity gate (Wave 1)

## Objective
Add a canonical-fidelity guardrail to `@sentropic/chat-ui`: a reference-validation manifest + a vitest test (running inside the existing `make test-chat-ui` / `validate-chat-ui` CI job — NO ci.yml/Makefile change) that classifies every exported component and FAILS if a new component is unclassified or if a canonical assembly composes a `legacy` component. Honestly classify the current state (orphans → legacy). See `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §2–§3.

## Scope / Guardrails
- Scope limited to `packages/chat-ui` test + manifest (NO component/src behavior change).
- Make-only workflow; ENV last; isolated worktree `tmp/chatui-no-orphan-gate`.
- Tests on dedicated env; never `ENV=dev`; never `make clean-all`.
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/chat-ui-reference-validation.json` (new manifest)
  - `packages/chat-ui/tests/**` (new test)
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `packages/chat-ui/src/**` (no component change in this branch)
  - `ui/**`, `api/**`
  - `plan/NN-BRANCH_*.md` (except this file)
- **Conditional Paths**: none expected.
- **Exception process**: declare `BR-FID1-EXn` in `## Feedback Loop` before touching any forbidden/conditional path.

## Feedback Loop
- none

## AI Flaky tests
- Accept only non-systematic provider/network flakiness; never add timeouts; document signature + sign-off before merge. (NB: e2e suite is currently flaky across groups — re-run, don't chase as code bug, unless deterministic.)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single additive guardrail)
- [ ] Multi-branch
- Rationale: one isolated, additive test + data file.

## UAT Management
- No UI change → no UAT surface. Validated by the chat-ui test suite itself.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/chatui-no-orphan-gate` on `feat/chatui-no-orphan-gate` confirmed.
  - [x] Env: `ENV=feat-chatui-gate`; ports API 9305, UI 5405, MAILDEV 1305.
  - [x] Read `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §2–§3; enumerate exported `./components/*.svelte` from `packages/chat-ui/package.json`.

- [x] **Lot 1 — Manifest + gate test**
  - [x] Create `packages/chat-ui/chat-ui-reference-validation.json` classifying EVERY exported `./components/*.svelte` as one of: `primitive` (with `dogfoodedBy: ["ui/src/..."]`), `assembly` (with `composes: [...]` + `assemblyValidatedBy`), `headless`, or `legacy` (with `deprecation: {owner, note}`). Current honest state: ModelSelector/MessageActions/ChatComposer/ChatTimeline/ChatPanel/ChatWidget/StreamMessage = primitive dogfooded; ContextChips = legacy (replaced by ChatContextPicker, Wave 2); SessionList = legacy (re-extract-or-retire); ChatConversation = legacy TEMP (rebuild on validated primitives + parity harness, Wave 3) — classify legacy now because it imports the legacy ContextChips.
  - [x] Create `packages/chat-ui/tests/reference-validation.spec.ts` (vitest) that: (a) enumerates exported `./components/*.svelte` from `package.json`; (b) asserts each is present in the manifest with a valid class — FAIL on any unclassified exported component; (c) asserts every `assembly`'s `composes` entries are all canonical (primitive/assembly, NOT legacy) and its `assemblyValidatedBy` file exists; (d) best-effort dogfooding check: if `ui/src` is readable from the test, assert each `primitive`'s `dogfoodedBy` path imports it; if `ui/src` not reachable in the test sandbox, skip with a `console.info` note (do NOT hard-fail on unreachable ui/).
  - [x] Verify `make test-chat-ui ENV=test-chatui-gate` passes (the test goes GREEN with the honest current classification). 45 tests, all pass.
  - [x] Run FULL chat-ui CI subset locally: `make typecheck-chat-ui`, `make build-chat-ui`, `make pack-chat-ui`, `make test-chat-ui`, `make test-chat-ui-dom` (ENV last). All green. 400 + 98 = 498 tests pass.
  - [x] Confirm NO `packages/chat-ui/src/**` change → `enforce-package-bump` not triggered (no version bump needed).

- [ ] **Lot N — Final validation**
  - [ ] Full chat-ui CI subset green locally.
  - [ ] PR with this BRANCH.md as body.
  - [ ] Branch CI green (ALL checks; re-run e2e flakes — never merge red).
  - [ ] Remove BRANCH.md, push, merge.
