# Feature: App Vue C0 chat ownership and design-system gap audit

## Objective
- [ ] Audit the pinned 7,052 application-host lines, the 1.0.1 package and the immo 0.33 host before the Vue port.
- [ ] Deliver assigned behaviour/DOM rows, all 24 view mappings and the C2a/C2b/C3/C4 recalibration.

## Scope / Guardrails
- [x] Approved packet: `.tmp/packets/app-vue-c0.md`; plan SHA-256 `277104d6cd95a7d3cb91ffca1644a088b937fb9e067247f19779c955887eb2b7`.
- [x] Branch `feat/app-vue-c0`, worktree `tmp/worktrees/app-vue-c0`, based on `origin/main`.
- [x] Reference `c40b8d1b56372fe1f2e8063ea6069e403dfe4942`; no reference repin.
- [x] Documentation and fixtures only; no runtime, dependency, DS installation or V8 work.
- [x] D1 and D2 are conductor-owned decide-and-trace defaults; other section-8 decisions remain open.
- [x] Environment `feat-app-vue-c0`; reserved API/UI/Maildev ports `9400/5600/1500`; no service starts required.
- [x] Make-only checks; Docker commands, if needed, use `docker-slot.sh`; check free disk before building.
- [x] Selective staging, commits below 150 lines, `make commit`, no trailers; push and PR, no merge.
- [x] No secrets, no Python, English repository documents.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `packages/chat-ui/tests/fixtures/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `api/**`
  - `ui-vue/**`
  - `ui-shared/**`
  - `packages/chat-ui/src/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `BRANCH.md` (branch control artifact required by the packet, BR00-EX1).
- **Exception process**:
  - [x] BR00-EX1: allow the required branch control artifact only; no implementation scope expansion; rollback restores the inherited branch file.

## Feedback Loop
- [x] C0-F0: initial native scope check flagged the required `BRANCH.md` as unknown; commit already created. Corrected by declaring BR00-EX1 and rerunning the check; retain this process deviation.
- [ ] C0-F1: DS session reviews the DS-usage column before acceptance; preserve its actual receipt, never self-approve.
- [ ] C0-F2: designated conductor records the recalibration and lot evidence in Track; this lane never writes the shared journal.

## AI Flaky tests
- [x] None: documentation-only audit, no AI-dependent test.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one C0 audit; independent review before handoff; no integration or cherry-pick.

## UAT Management (in orchestration context)
- [x] No application behaviour changes; acceptance is audit coverage and independent review.

## Plan / Todo (lot-based)
- [x] Lot 0 — Baseline and scope
  - [x] Read MASTER, workflow, testing, COMMON-RULES, approved plan sections 1–5 and C0 row/detail.
  - [x] Confirm approved plan digest and `harness check branch` PASS.
  - [x] Preserve root checkout and isolate C0 on origin/main.
- [ ] Lot 1 — Exhaustive ownership ledger
  - [x] `spec/APP_VUE_C0_HOST_OWNERSHIP.md`: continuous source ranges covering all four pinned hosts, with package/host ownership and destination lot.
  - [ ] Cross-check reference ranges against git blobs; account for current-main drift separately.
- [ ] Lot 2 — Behaviour, DOM and DS audit
  - [ ] `spec/APP_VUE_C0_AUDIT.md`: three-column host/package/immo comparison, transfer list and compatibility requirements.
  - [ ] `spec/APP_VUE_C0_DS_MAPPING.md`: all 24 views, utility dependence, primitives and recalibration method.
  - [ ] DS session review receipt and remaining props gaps recorded.
- [ ] Lot 3 — Verification and handoff
  - [ ] File-level checks: source hashes/counts, exact range partition, view inventory and ownership completeness; no runtime tests warranted.
  - [ ] Independent review reconciled against the audited sources.
  - [ ] Native harness scope check before each commit; final `git diff --check`.
  - [ ] Create PR with this file as its body and add its 3-step execution plan.
  - [ ] CI green on exact pushed head; leave PR unmerged.
  - [ ] Record deliverable file:line, checks, exit-gate evidence, Track handoff, PR and CI in `.tmp/rv/app-vue-c0.md`; write `.done` last.
