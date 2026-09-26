# Feature: GPT-6 Sol and Luna routing candidate

## Objective
- [ ] Prepare @sentropic/llm-mesh 0.22.1 with GPT-6 Sol/Luna and updated routing; no push, PR, merge or publication.

## Scope / Guardrails
- [x] Worktree `tmp/llm-mesh-gpt6`, branch `feat/llm-mesh-gpt6`; mechanical harness branch check passed.
- [x] Make-only Docker checks; `ENV=test-llm-mesh-gpt6` last; ports API 9472, UI 5672, Maildev UI 1572.
- [x] Atomic commits below 150 changed lines, explicit staging, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `scripts/llm-model-equivalences/**`
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/llm-gateway/**`
  - `packages/cluster-mesh/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
- [x] **Conditional Paths**: `package-lock.json` via make if bump requires it; `docs/runbooks/model-update-launch-packet.md` only for an incorrect procedure.
- [x] Exceptions: none; explicit owner scope supersedes wider runbook consumer/publication requirements.

## Feedback Loop
- [x] G6-01 attention: conductor real `codex exec -m <id>` calls on 2026-09-26 verified Sol, Luna and Astra with ChatGPT-account login; direct OpenAI API availability remains unverified.
- [x] G6-02 attention: GPT-6 Terra returned HTTP 400 unsupported on that account; omit it entirely and retain GPT-5.6 Terra targets.
- [x] G6-03 attention: inherit matching 5.6 profile capabilities as unverified, with code comments; no invented context/output limits.
- [x] G6-04 attention: council generator supports exclusions only; classify new models as excluded like matching 5.6 models, without asserting benchmark equivalence.
- [x] G6-05 attention: retain GPT-5.6 catalog entries and faithful direct routes for reversibility; switch standard alias targets only.
- [x] G6-06 attention: owner limits consumer changes; gateway/cluster compatibility tested against workspace; product/API and external host defaults remain conductor work.

## AI Flaky tests
- [x] No live tests or flaky acceptance planned; conductor receipts establish model availability only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; independent review belongs to conductor handoff.

## UAT Management (in orchestration context)
- [x] Library-only change: no web, Chrome or VSCode UAT; verify callable route identities with deterministic tests.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, template, runbook, scaffold tests/script; confirm npm latest 0.22.0 and branch.
- [x] Lot 1: scaffold Sol/Luna; review catalog/providers; bump package.json and CHANGELOG; remove scaffold markers.
- [x] Lot 2: switch standard routing targets; classify council source and regenerate output; Cloud Code capability aliases need no change.
- [ ] Lot 3: update routing-targets, route-selection, facade, budget-quote and add-model-script tests; assert new Codex routes and no GPT-6 Terra target.
- [ ] Lot 4: typecheck, lint, full mesh tests, build, pack and council freshness checks.
- [ ] Lot 5: gateway and cluster workspace regression tests; scope checks; candidate SHA-256 and commit history; environment cleanup.
