# Feature: Route facade poll completion to the owning enrollment provider

## Objective
`LocalAccountTransportService.pollForCompletion` hardcoded the codex provider and openai/codex serving ids, so a `mistral-vibe` enrollment started through the facade could never complete (the codex poll answered "Enrollment session not found"). Route the poll by the provider that started the session and persist the account with the provider's serving pair. Ship as `@sentropic/llm-mesh@0.23.1` (h2a integration request, envelope env:reply:9b8abe9d-muzsax47).

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/**`, `package-lock.json`.
- Make-only workflow; CI green before merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/cluster-mesh/tests/**` (selected train fixture refresh, via `refresh-lazy-package-lock`)
  - `package-lock.json` (llm-mesh 0.23.1 version field)
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`
- **Conditional Paths**:
  - `package-lock.json` (semver bump artifact — BR78-EX1, same rollback as #650: `git checkout package-lock.json`)

## Feedback Loop
- `attention`: fix design mirrors the in-vivo patch reported by vibe:h2a:9b8abe9d001b, minus the `enr_mistral_vibe_*` prefix sniffing — `enroll()` records enrollmentId → providerId instead, with codex kept as the fallback for legacy in-flight sessions.
- `attention`: `waitForCallback` still hardcodes the `cloud-code` provider (pre-existing, same latent shape) — intentionally untouched in this branch; noted for follow-up.
- `attention`: the cluster-mesh selected train fixture lock pins llm-mesh 0.23.0; refreshed to 0.23.1 via `pack-candidate-siblings` (MANIFEST_CONTEXT_FILE) + `refresh-lazy-package-lock`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single-package fix vertical.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Fix + regression test**
  - [x] `enroll()` records enrollmentId → providerId; `pollForCompletion` routes by that map (fallback codex), serving ids via `POLL_ENROLLMENT_SERVING_IDS` (codex → openai/codex, mistral-vibe → mistral/mistral-vibe).
  - [x] Regression test: mistral-vibe enrollment completes through the facade, codex never polled, account acquirable via mistral/mistral-vibe.
  - [x] `make typecheck-llm-mesh` + `make test-llm-mesh`: 325/325.
  - [x] llm-mesh 0.23.1 + root lockfile version field.
- [ ] **Lot 2 — Train fixture + CI**
  - [ ] Selected train fixture lock refreshed to llm-mesh 0.23.1.
  - [ ] CI green (49 checks), then merge.
