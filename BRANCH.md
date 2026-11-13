# Fix: OpenAI Chat Completions token limits and safe error observation

## Objective
- [ ] Correct incompatible token limits and expose safe provider failure metadata.

## Scope / Guardrails
- [x] Execute the approved openai-400-fix packet in `tmp/worktrees/openai-400-fix`.
- [x] Use make targets and Docker slot wrapper; no live provider calls or workflow dispatch.
- [x] Environment `fix-openai-400`; API 9490, UI 5690, Maildev 1590; verify ports before tests.
- [x] Preserve root dev; no timeouts increased, no package changes, no merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/llm-runtime/**`
  - `api/src/services/chat-service.ts`
  - `api/src/services/providers/openai-provider.ts`
  - `api/tests/**`
  - `e2e/fixtures/provider-server.mjs`
  - `e2e/fixtures/provider-server.test.mjs`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions requested.

## Feedback Loop
- [x] Historical provider rejection parameter remains unknown; hermetic tests establish the corrected request contract.
- [x] Track integration belongs to the conductor single writer; include deliverables in the lane report.

## AI Flaky tests
- [x] No live AI tests authorized; no flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; implementation follows the supplied packet.

## UAT Management (in orchestration context)
- [x] No UI changes; hermetic API and observer qualification only.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read packet, diagnosis, rules and template; create isolated branch; mechanical branch check.
- [x] Lot 1 — Correct OpenAI Chat Completions limits using catalog reasoning capabilities and family guards.
  - [x] Add `api/tests/unit/llm-runtime-generation.test.ts` for the real title call and legacy model.
- [x] Lot 2 — Warn on title failure with safe structured provider metadata; retain null result.
  - [x] Add focused title failure tests under `api/tests/unit/`.
- [ ] Lot 3 — Add bounded observer and hermetic sentinel tests in `e2e/fixtures/provider-server.test.mjs`.
- [ ] Lot 4 — Final validation and delivery.
  - [ ] Scoped make tests; API typecheck/lint; independent code review.
  - [ ] Scope check before each atomic commit under 150 lines.
  - [ ] Push and open PR using this file; verify CI on exact head without merging.
  - [ ] Tear down test volumes; write report and completion marker.
