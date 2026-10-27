# Feature: Live STT L8 gateway speech and usage

## Objective
- [ ] Bind bounded speech admission, usage and settlement to the gateway ledger owner.

## Scope / Guardrails
- [x] Base origin/feat/live-stt-l2; branch feat/live-stt-l8; worktree tmp/worktrees/stt-l8.
- [x] Spec: .tmp/live-stt/spec-plan.md L8, sections 7/11.2; aggregate USD 5 per UTC day / USD 20 campaign.
- [x] Make-only; ENV=test-stt-l8 last; no containers before 2026-10-27 21:00 UTC; shared flock thereafter.
- [x] Specific-file staging; make commit; under 150 changed lines per commit; no attribution trailers.
- [x] No inference, provider credentials, ledger replacement, native dependencies, publication or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/speech/**`
  - `packages/llm-gateway/tests/speech-*.test.ts`
  - `packages/llm-gateway/tests/fixtures/speech-*.ts`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/llm-gateway/src/index.ts`
  - `package-lock.json`
- **Exception process**:
  - [x] Declare BRL8-EXn with reason, impact and rollback before sensitive changes.

## Feedback Loop
- [ ] G-LEDGER: existing host sink supports monthly text budgets only; ledger owner must supply atomic speech admission and adjustments before cloud activation.
