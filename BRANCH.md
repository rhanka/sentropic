# Feature: Foundation specs v3 — Codex 2nd-engine reconciled (BR-42l + ARCH-11)

## Objective
Amend the two foundation design specs to v3, integrating the independent Codex 5.5xhigh 2nd-engine adversarial findings (full double-consensus now complete: Opus author → Opus adversary → Codex → reconciled). Doc-only, fast-merge. Still DESIGN only — nothing implemented/published/cut over until owner-final (ARCH-11 prod cutover = owner signature).

## Scope / Guardrails
- Scope limited to `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` + `spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md`.
- No code, no migration, no runtime change.
- Make-only workflow, English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`
  - `spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
- **Conditional Paths**: `.github/workflows/**`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop`.

## Feedback Loop
- `acknowledge`: full double-consensus complete on both specs. Codex caught a real cross-tenant OAuth consent gap (ARCH-11) + the un-split leaky root (BR-42l) the Opus loop missed; both integrated in v3.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (doc-only)
- [ ] **Multi-branch**
- Rationale: two documentation files, no build/test surface.

## Plan / Todo (lot-based)
- [x] **Lot 1 — v3 Codex reconciliation**
  - [x] BR-42l: hardened publish gate + declarative-vs-execution decision + concrete api-extractor gate + `ConnectorSecretRequirement.scope += 'operator'`.
  - [x] ARCH-11: consent tenantization (security) + OBO S2S contract + enrollment/single-org fix + soft-ref control fix + staged G1a-d + rollback containment.
- [ ] **Lot N — Final**
  - [ ] Register BR-42l / BR-42m / coupled-G1 (G1a-d) via the track lane.
  - [ ] Remove BRANCH.md, push, merge.
