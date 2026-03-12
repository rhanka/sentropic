# Feature: Codex Sign-In Enablement (Dev/VSCode Plugin)

## Objective
Pivot BR-02 away from OpenAI SSO inside this application and define a Codex sign-in strategy for development and VSCode plugin usage.

Important product decision:
- This branch does **not** deliver OpenAI OAuth/OIDC login for app end users.
- This branch aligns with Codex/ChatGPT sign-in usage for coding workflows only.
- Any runtime/plugin implementation work (if applicable) belongs to BR-05, not BR-02.

## Scope / Guardrails
- Scope limited to:
  - rollback of in-app OpenAI SSO implementation attempted earlier in BR-02;
  - documentation/spec alignment for Codex sign-in usage in dev/plugin workflows.
- No `Makefile` or docker-compose changes.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` remains reserved for user UAT/dev (`ENV=dev`).
- Branch environment mapping remains defined for consistency: `ENV=feat-sso-chatgpt` `API_PORT=8702` `UI_PORT=5102` `MAILDEV_UI_PORT=1002`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/02-BRANCH_feat-sso-chatgpt.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `spec/**`
  - `PLAN.md`, `TODO.md`
  - `scripts/**`

## Scope Exceptions
- `BR02-EX1` (resolved 2026-02-22)
  - Path: `spec/SPEC_EVOL_VSCODE_PLUGIN.md`
  - Reason: codify Codex sign-in constraints for VSCode plugin roadmap after product pivot.
  - Impact: documentation only.
  - Rollback: revert this file section.

## Questions / Notes
- Decision confirmed by product owner (2026-02-22):
  - OpenAI in-app SSO is not required now.
  - Target utility is Codex sign-in for development/plugin coding workflows.
- Billing constraint captured:
  - Codex/ChatGPT sign-in may provide included Codex usage (plan-limited) for coding workflows.
  - It does not provide free OpenAI API usage for this backend.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: pivot + cleanup + docs alignment only.

## UAT Management (in orchestration context)
- UAT is not required for this branch after pivot, because the resulting delta is docs/process only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & pivot decision**
  - [x] Validate branch objective mismatch against product constraints.
  - [x] Confirm pivot with user: Codex sign-in for dev/plugin only.

- [x] **Lot 1 — Remove in-app OpenAI SSO implementation**
  - [x] Revert `feat(auth): add OpenAI SSO linked-state UI and unlink flow` (`130e9be`).
  - [x] Revert `feat(auth): add OpenAI SSO UI entrypoints and capture Lot 1 gate blockers` (`392ba71`).
  - [x] Revert `feat: checkpoint lot0 and lot1 progress` (`7b4a2d7`).
  - [x] Ensure no residual refs for `OPENAI_SSO_*`, `/auth/sso/openai`, `sso-openai-adapter`.

- [x] **Lot 2 — Codex sign-in roadmap alignment**
  - [x] Recreate branch execution file (`BRANCH.md`) for the new objective.
  - [x] Update this branch plan to reflect pivoted scope and acceptance.
  - [x] Update VSCode plugin evolution spec with Codex sign-in constraints and usage boundaries (`BR02-EX1`).

- [x] **Lot N — Final validation**
  - [x] Verify branch status is clean after rollback + docs updates.
  - [x] Confirm no runtime/API/UI behavior change remains from prior OpenAI SSO attempt.
  - [x] Mark branch as mergeable docs/process pivot.

## References (OpenAI official)
- Codex CLI sign-in with ChatGPT: <https://help.openai.com/en/articles/11381614-codex-cli-and-sign-in-with-chatgpt>
- Codex with ChatGPT plans: <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan>
- ChatGPT vs API billing separation: <https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform>
