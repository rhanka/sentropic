# Feature: Durable conductor design artifacts

## Objective
- [x] Preserve the seven owner-selected design artifacts byte-for-byte under `docs/specs/`, with source paths, SHA-256 hashes, review status and existing Track references.
- [ ] Open a documentation-only PR to `main`, observe exactly one CI run, and report its PR/head/result/index to `.tmp/rv/docs-durable.md`; stop without merging.

## Scope / Guardrails
- [x] Owner request: `.tmp/packets/docs-durable.md`; author: Codex `gpt-6.1-sol`, xhigh.
- [x] Branch: `docs/durable-design-artifacts-20261101`, based on `origin/main` at `329cc11d0` (Track sync PR #865 merged).
- [x] Worktree: `tmp/worktrees/docs-durable`; orchestration: one author and one Track writer in this worktree.
- [x] Make-only commands; `ENV=test-docs-durable` last whenever an environment is supplied.
- [x] Documentation checks only: secret-value scans, source/destination byte and hash checks, Track validation, scope checks and one PR CI run.
- [x] Retain the inherited CI lockfile-lane policy acknowledgment `review_by=2026-11-30T00:00:00Z`; this branch changes no install surface.
- [x] No application/API/UI/E2E behavior changes; no application test or UAT campaign is applicable.
- [x] New metadata is English; verbatim sources retain their original language and wording under the owner's copy instruction.
- [x] No services or ports required; root development remains untouched.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/specs/**`
  - `.track/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `BRANCH.md`
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare `BRxx-EXn` with reason, impact and rollback before touching an exceptional path.

## Feedback Loop
- [x] BR20261101-EX1 — `BRANCH.md`: required branch metadata explicitly requested by the owner; impact limited to planning/PR/Track import; rollback by reverting this branch's metadata.
- [x] BR20261101-EX2 — owner-authorized exemption from the 150-line limit only for the following verbatim copies; rationale: keep the peer-referenced bytes and hashes; impact: documentation additions only; rollback: revert the copy commit.
  - [x] `docs/specs/geo-fcm/assessment.md`
  - [x] `docs/specs/cm-identity-agents/r2.md`
  - [x] `docs/specs/cm-identity-agents/A2-lots.md`
  - [x] `docs/specs/cm-identity-agents/owner-answers-20261030.md`
  - [x] `docs/specs/voice-s2s/study-r2.md`
  - [x] `docs/specs/daily-cyber/activation-plan.md`
  - [x] `docs/specs/remote-control/plan-v1.1.md`
- [x] BR20261101-EX2 also preserves inherited prose, dates, estimates and relative references without editing; the index explains provenance and review limits.
- [x] The earlier designated Track sync writer finished in merged PR #865; this worktree is the single writer for this request's branch import.
- [x] The Spark r2 review approves the exact identity r2 hash but cites older owner-answer bytes; the current owner-answer file has no matching independent approval.
- [x] Verbatim geo and remote-control sources contain trailing blank lines; preserve them for hash identity; whitespace checks pass for all newly authored metadata.
- [x] New peer-review selection is unavailable: the required `h2a_run` MCP tool is absent; `.tmp/rv/docs-durable-review.md` records selection failure; no new consensus claimed, conductor review remains pending before merge.

## AI Flaky tests
- [x] Not applicable: no AI test campaign or accepted flaky result.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — preserve the supplied sources and import only this branch's request/lots into Track.
- [ ] **Multi-branch** — not required.

## UAT Management (in orchestration context)
- [x] Documentation acceptance: seven exact copies, complete index, no secret-value matches, valid Track, mechanically checked branch/scope, one completed CI.
- [x] No web, Chrome or VSCode UAT applies to documentation-only preservation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and safe inputs**
  - [x] Read common rules, repository workflow, harness and Track contracts.
  - [x] Create the requested worktree from fresh `origin/main`; mechanically check the branch.
  - [x] Query Track from this worktree root; find existing source-related items without duplicating them.
  - [x] Scan each source for credential/token values; refuse a matched source before copying.
- [x] **Lot 1 — Preserve and index**
  - [x] Copy all seven named artifacts without transforming bytes.
  - [x] Compare every destination to its source with `cmp` and SHA-256; enforce the three expected prefixes and geo byte count.
  - [x] Write `docs/specs/INDEX-durable-artifacts.md` with review evidence and existing Track IDs.
  - [x] Import this branch's request and lots through `track branch import BRANCH.md`; run `track validate`.
  - [x] Run `make scope-check` before each selective-stage `make commit`; retain fewer than 150 non-exempt changed lines per commit.
- [ ] **Lot 2 — PR, CI and handoff**
  - [ ] Push only the locally verified final head and open a PR using this file as its body.
  - [ ] Observe exactly one CI run for that head through completion; do not rerun or dispatch an extra workflow.
  - [ ] Save PR, head, CI result and complete index to `.tmp/rv/docs-durable.md`.
  - [ ] Stop with the PR open; do not merge or remove this branch plan.
