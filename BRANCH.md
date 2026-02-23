# Feature: BR-02 Codex Sign-In Rebaseline (Dev/VSCode Only)

## Objective
Rebaseline BR-02 to Codex sign-in usage for development and VSCode plugin workflows only.
This branch does not implement OpenAI SSO for app end users.

## Scope / Guardrails
- Scope is docs/process alignment only in this branch.
- Keep runtime app auth unchanged; do not reintroduce OpenAI SSO routes, services, or UI flows.
- No changes to `Makefile`, `docker-compose*.yml`, or `.cursor/rules/**`.
- Branch work remains in `tmp/feat-sso-chatgpt`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/02-BRANCH_feat-sso-chatgpt.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)

## Questions / Notes
- Product decision confirmed on 2026-02-22:
  - no app end-user OpenAI OAuth/OIDC login in BR-02.
  - Codex sign-in is for developer/plugin coding workflows only.
- Billing clarification:
  - Codex/ChatGPT sign-in may provide included Codex usage (plan-limited) for coding workflows.
  - It does not provide free OpenAI API usage for this backend.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: BR-02 is now a narrow docs/process pivot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Pivot baseline**
  - [x] Confirm product direction and remove in-app OpenAI SSO implementation.
  - [x] Align BR-02 docs/spec scope with Codex sign-in boundaries.

- [x] **Lot 1 — Runtime residual validation**
  - [x] Confirm no residual `/auth/sso/openai` runtime route references remain.
  - [x] Confirm no `sso-openai-adapter` service file remains.
  - [x] Confirm no `OPENAI_SSO_*` or `SSO_LINK_REQUIRED` runtime usage remains.

- [x] **Lot N — Finalization**
  - [x] Keep BR-02 mergeable as docs-only pivot.

## Next Implementation Track
- Implementation work moves to VSCode plugin branches:
  - `feat/vscode-plugin-v1`: define Codex sign-in bridge for developer/plugin workflows.
  - `feat/vscode-plugin-v2-multi-agent`: extend orchestration flows without introducing app end-user OpenAI SSO.
- BR-02 remains limited to documentation and scope guardrails.
