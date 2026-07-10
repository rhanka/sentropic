# Feature: BR-39e Social/Enterprise Federation — grounded STUDY

## Objective
Produce a grounded, decision-grade options/trade-offs study for adding upstream social/enterprise
login federation (Google/GitHub/Microsoft/Apple/Facebook) to the Sentropic IdP. STUDY only — frames
owner-gated decisions, no implementation.

## Scope / Guardrails
- Spec artifact only. No code, no package, no auth-hono/api source edits, no migration.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); work happens in `tmp/auth-federation-study`.
- No push, no PR (study rung).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_STUDY_39E_SOCIAL_FEDERATION.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/auth-hono/**`, `packages/auth-ui/**`, `api/**`, `apps/**`, `ui/**`
  - any other `spec/**` or `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - none

## Feedback Loop
- (none)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single study artifact; no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: one non-code spec deliverable; no CI, no independent validation streams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Ground on current main**
  - [x] Read auth-hono IdP (ports/contracts/session/oauth authorize/state-codec/router).
  - [x] Read user+identity model (`api/src/db/schema.ts`), confirm NO `identities` table.
  - [x] Read enrollment path (`api/src/routes/auth/register.ts`), magic-link, secret-crypto.
  - [x] Read auth-ui `AuthLogin`/`AuthRegister` + auth-idp `+layout.svelte` (AppChrome) + `ui/` Header.
- [x] **Lot 1 — Write the study**
  - [x] Providers + quirks, build approach (arctic vs alternatives), broker model, `identities` +
        linking policy (verified-email gate), security, IdP routes, UI, multi-tenant, roadmap.
  - [x] `## Owner decisions (batched)` D-1..D-8 with inline context.
  - [x] `## Adjacent: DS header on auth screens` (options a/b/c + reco).
  - [x] Lot gate: study committed; no push/PR.
