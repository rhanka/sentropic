# Feature: align @sentropic/llm-mesh + llm-gateway to 0.7.0 stable

## Objective
Promote `@sentropic/llm-mesh` `0.7.0-rc.0` → `0.7.0` stable (ships GPT-5.6 catalog + Luna default + Claude enrollment) and ALIGN `@sentropic/llm-gateway` to it (`0.3.0` → `0.7.0`, dep `^0.6.0` → `^0.7.0`), so a real e2e (h2a runtime + gateway + mesh) can be validated on ONE aligned 0.7.0 line. Owner directive 2026-07-13: no promotion without gateway↔mesh alignment; re-test with h2a after.

## Scope / Guardrails
- Version + dependency alignment only (no src change): `packages/llm-mesh/package.json`, `packages/llm-gateway/package.json`, root `package-lock.json` (regenerated via `make lock-root`).
- Make-only; branch in `tmp/feat-align-mesh-gateway-070`; `ENV=<env>` last. English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/llm-mesh/package.json`, `packages/llm-gateway/package.json`, `package-lock.json`, `tmp/feat-align-mesh-gateway-070/BRANCH.md`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, other `plan/NN-BRANCH_*.md`, any `src/**`.
- **Conditional**: `.github/workflows/**`.

## Lots
- [x] Lot 1 — llm-mesh `0.7.0-rc.0` → `0.7.0`; drop `publishConfig.tag: rc` (publishes `latest`).
- [x] Lot 2 — llm-gateway `0.3.0` → `0.7.0`; dep `@sentropic/llm-mesh` `^0.6.0` → `^0.7.0`; root lockfile relocked (nested registry 0.6.1 removed → workspace-linked).
- [ ] Lot 3 — CI green; merge → publishes llm-mesh 0.7.0 (`latest`, overtakes 0.6.1) + llm-gateway 0.7.0.
- [ ] Lot 4 — Ask h2a to re-align h2a-runtime to the published 0.7.0 packages and RE-TEST the Claude enroll+serve e2e on the aligned line.

## Feedback Loop
- Owner: promotion authorized (RC gated on Claude enrollment = validated client+server; serve path = SEPARATE gate held on architect ToS constraint, not part of this promotion).
- attendu (h2a): re-test on aligned 0.7.0 after publish.

## Orchestration Mode
- [x] Mono-branch. Rationale: pure version/dep alignment.

## UAT Management
- No dev stack. Validation = CI green + published dist-tags (`latest` = 0.7.0) + h2a re-test.
