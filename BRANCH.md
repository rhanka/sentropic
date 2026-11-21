# Feature: Host-configured external sources on the artifacts content CSP

## Objective
Let an artifacts host allow exact HTTPS origins as frame sources and as
media/image sources on served HTML (radar-immobilier AQX: YouTube nocookie
embeds and Sentropic bucket media), without changing any policy by default.

## Scope / Guardrails
- Scope limited to `packages/artifacts/src/content/headers.ts` and its tests.
- Make-only workflow, no direct Docker commands; `ENV` last, `ENV=test-*` only.
- Branch development in `tmp/artifacts-csp-external-sources`.
- No version bump or publication in this branch (release is a separate act).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/content/headers.ts`
  - `packages/artifacts/tests/content-external-sources.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/artifacts/package.json` (version bump, not in this branch)

## Feedback Loop
- `attention`: consumer is rhanka/radar-immobilier branch
  `feat/artifacts-quota-exceptions`, which composes the same directives
  host-side until a qualified provider release carries this option.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one additive, opt-in option.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Opt-in external sources**
  - [x] `ContentHeaderInput.externalSources` (`frame`, `media`), HTML only, both modes.
  - [x] `withExternalSources` refuses any value that is not an exact HTTPS origin.
  - [x] Unit tests: unchanged defaults, directive-only changes, non-HTML untouched, refusals.
  - [x] Lot gate: `make typecheck-artifacts` + `make test-artifacts SCOPE=tests/content-` on `ENV=test-artifacts-csp` (7 files, 90 tests).
- [ ] **Lot 2 — Merge & close**
  - [ ] Push branch, open PR, verify CI green.
