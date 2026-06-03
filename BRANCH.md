# Fix: CI AI-shard trigger covers chat runtime deps

## Objective
Close the CI trigger gap that let a deterministic chat-persistence race ride green PR gates: the `test-api-unit-integration` AI shard runs only when `changes.api` or `changes.global` is true, but the `api:` path-filter did not include `packages/chat-core`, `packages/events`, `packages/contracts` — the runtime deps the API consumes. A PR touching only those packages skipped the API integration tests (incl. `chat-tools`) entirely.

## Scope / Guardrails
- Single-file CI path-filter fix in `.github/workflows/ci.yml`.
- Make-only workflow, no direct Docker commands.
- Branch in isolated worktree `tmp/fix-ci-ai-shard-trigger`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - app/package source (this branch changes ONLY the CI filter)
- **Conditional Paths**:
  - `.github/workflows/ci.yml` — covered by exception FIXTRG-EX1 below.

## Feedback Loop
- FIXTRG-EX1: edit `.github/workflows/ci.yml` (forbidden-by-default CI path). Reason: the `api:` path-filter omits the API's chat runtime deps (`packages/chat-core`, `events`, `contracts`), so changes there do not trigger the API integration + AI shards that exercise them — this is the structural trigger gap that allowed the `chat_stream_events`/`chat_messages` FK race to ride green gates (forensics: `docs/uat/2026-06-03-chat-tools-fk-forensics.md` on BR-14e). Impact: more PRs will (correctly) run the API integration shard; slightly more CI time on chat-package PRs, no behavior change. Rollback: revert the 3 added globs in the `api:` filter. Status: approved by branch plan.

## Mode
- Mono-branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/fix-ci-ai-shard-trigger` off `origin/main`; branch verified.
  - [x] Forensic root cause established (BR-14e investigation): AI shard gated on `api||global`; `api:` filter missed `packages/{chat-core,events,contracts}`.
- [x] **Lot 1 — Widen `api:` path-filter**
  - [x] Add `packages/chat-core/**`, `packages/events/**`, `packages/contracts/**` to the `api:` filter in `.github/workflows/ci.yml` (flow + chat-server + llm-mesh already present).
- [ ] **Lot N — Validate + PR**
  - [ ] Push; confirm CI parses the workflow (no YAML error) and the `changes` job runs.
  - [ ] Verify on this PR that touching `ci.yml` (a `global` path) triggers the API shards as expected.
  - [ ] PR with `BRANCH.md` body; merge-commit; remove `BRANCH.md` before merge.

## Notes
- This is the TRIGGER half of fix-A. The RACE half (commit session/assistant-message before stream-events/generation-traces) is a separate branch owned by the chat-core/chat-server lineage: `fix/chat-persistence-write-order`. Order: trigger first (this), then race.
- The `ai:` output declared in `changes` has no filter block (always false / dead) — left as-is here; the shard is correctly gated on `api||global`, which this branch makes exhaustive. Removing the dead `ai` output is out of scope.
