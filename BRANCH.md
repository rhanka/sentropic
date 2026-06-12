# Feature: chat-ui DS theming seam (BR-38d-theming)

## Objective
Give @sentropic/chat-ui a generic theming seam (CSS custom-property token contract, defaults = exact current sentropic look) so the design-system docs site can consume the real package with DS tokens, with zero visual/DOM change for sentropic.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**` (styling seam + docs + tests) and minimal ui-side verification.
- No behavioral forks; one canonical component, themable.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/chatui-ds-theming`.
- Test envs: `ENV=test-dschat` (+ REGISTRY=local API_PORT=9495 UI_PORT=5595 MAILDEV_UI_PORT=1495), `ENV` last.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/**`
  - `ui/tailwind.config.cjs` (only if token mapping requires it)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `e2e/**` (oracles must stay untouched)
- **Conditional Paths (allowed only with explicit exception)**:
  - `ui/src/**` (only if host CSS must reference the new tokens)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR38d-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- (none yet)

## AI Flaky tests
- Acceptance rule: per template (non-systematic provider nondeterminism only; never additive timeouts).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single package-scoped seam; one test cycle.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Gap analysis & design**
  - [ ] Inventory chat-ui styling surface (tailwind utilities, style blocks, streamdown)
  - [ ] Inventory DS repo chat implementation + token system (read-only)
  - [ ] Consume DS lane gap list via h2a (or proceed on evidence + re-ping)
  - [ ] Design theming seam, double adversarial review (Codex xhigh + Opus)
- [ ] **Lot 1 — Theming seam implementation**
  - [ ] Implement token seam in packages/chat-ui (defaults = current sentropic values)
  - [ ] Document contract (packages/chat-ui/THEMING.md or README section)
  - [ ] Bump @sentropic/chat-ui to 0.21.0
  - [ ] Lot gate:
    - [ ] `make typecheck-chat-ui` + `make lint`
    - [ ] `make test-chat-ui`
    - [ ] `make typecheck-ui` + `make test-ui` (known local flake: google-drive-picker 2-fail)
- [ ] **Lot 2 — Parity oracles (e2e)**
  - [ ] `make build-api build-ui-image ...` then `make test-e2e E2E_SPEC=tests/03-chat.spec.ts ...`
  - [ ] `make test-e2e E2E_SPEC=tests/04-tenancy-workspaces.spec.ts ...`
- [ ] **Lot 3 — Coordination & PR**
  - [ ] Send theming contract + publish notice to DS lane via h2a
  - [ ] Final gate: PR with gap analysis + contract + parity proof
