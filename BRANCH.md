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
- [x] **Lot 0 — Gap analysis & design**
  - [x] Inventory chat-ui styling surface (tailwind utilities, style blocks, streamdown)
  - [x] Inventory DS repo chat implementation + token system (read-only)
  - [x] Consume DS lane gap list via h2a (no reply yet; re-pinged on thread, proceeded on verified evidence)
  - [x] Design theming seam, double adversarial review (Codex xhigh: A/B/D/E accept-with-changes, C reject-as-written -> fixed; Opus: A/D/E accept, B/C accept-with-changes -> all changes applied)
- [x] **Lot 1 — Theming seam implementation**
  - [x] Implement token seam in packages/chat-ui (scripts/theme-token-map.mjs + gen-theme-css.mjs + committed src/theme/chat-ui.css; zero component/markup changes)
  - [x] Document contract (packages/chat-ui/THEMING.md, ships in tarball)
  - [x] Bump @sentropic/chat-ui to 0.21.0 (+ export ./theme.css, sideEffects css, prepack artifact gate)
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` (exit 0)
    - [x] `make test-chat-ui` (774/774 incl. new drift guard) + `make test-chat-ui-dom` (149/149)
    - [x] `make pack-chat-ui` (tarball ships dist/theme/chat-ui.css 33.4kB + THEMING.md; dist-form export rewrite verified)
    - [x] `make typecheck-ui` (0 errors, 6 pre-existing warnings) + `make test-ui` (442/442, no flake this run)
- [x] **Lot 2 — Parity oracles (e2e)**
  - [x] `make build-api build-ui-image` (exit 0) then 03-chat e2e: 14/14 passed
  - [x] 04-tenancy-workspaces e2e: 6/6 passed
  - [x] AI flaky note: first 03-chat run had 1 fail = `Provider auth source is not configured` (fresh worktree missing `.env` provider keys, NOT a regression); after copying `.env`, same commit + same command = 14/14. Env-config issue, no test amended, no timeout touched.
- [ ] **Lot 3 — Coordination & PR**
  - [x] Theming contract draft sent to DS lane via h2a (env:sentropic-ds-chat-align-ask:contract-draft-1); publish notice due post-merge
  - [x] Final gate: PR with gap analysis + contract + parity proof
  - [ ] Post-merge: npm publish 0.21.0 (CI auto on main) + publish notice to DS lane + owner ratification of durable names
