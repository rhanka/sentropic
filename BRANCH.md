# Feature: Opt-in Gemini Decisions capability

## Objective
- [ ] Integrate gemini-decision-1 through the existing host decision service without default egress.

## Scope / Guardrails
- [x] Branch feat/llm-mesh-gemini-decisions, isolated worktree tmp/worktrees/gemini-decisions.
- [x] Make-only, Docker-first; ENV=test-gemini-decisions last; no live calls or secrets in evidence.
- [x] No services needed; reserved API 9702, UI 5902, Maildev 1802.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**`

## Feedback Loop
- [x] Official announcement: https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/
- [x] Official REST request/response reference: https://aistudio.google.com/docs/decisions-api#request
- [x] ai.google.dev/api/decisions is unavailable; the announcement links to AI Studio documentation.
- [x] Google AI Studio has no Canadian residency guarantee; opt-in by exact evaluator only.
- [x] Documented responses omit served model identity. Preserve the existing identity gate and ship unqualified; never infer served identity from the request.
- [x] Track import reserved for the designated conductor; this plan is the source artifact.

## AI Flaky tests
- [x] Mocked transport only.

## Orchestration Mode
- [x] Mono-branch; separate from Muse because total scope exceeds 15 files.

## UAT Management (in orchestration context)
- [x] No UI surface; host routing tests qualify behavior.

## Plan / Todo (lot-based)
- [x] Lot 0: inspect official schema and existing native decision contracts.
- [ ] Lot 1: descriptor, codec and bounded transport; one question per existing DecisionRequest.
  - [x] Bounded v1beta transport, API-key header, deadlines and redirects refused.
  - [x] Native question and usage mapping; binary confidence validated then projected to P(true).
- [ ] Lot 2: adapter, host exports, credential restriction, pricing and reconstruction.
- [ ] Lot 3: mocked routing, schema/error/deadline tests and residency documentation.
- [ ] Lot 4: version 0.38.0, scoped checks, independent review and PR CI green.
