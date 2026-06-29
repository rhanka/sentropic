# Feature: Centralize diag canevas libs into sentropic (unpublished)

## Objective
Centralize the two diag canevas packages (`@sentropic/annotate`, `@sentropic/drawings-skills`) into the sentropic monorepo as new UNPUBLISHED workspace packages, per the owner directive "components live in sentropic, diag = site only". Copy-in only: no publish, no diag-repo changes, no merge.

## Scope / Guardrails
- Scope limited to `packages/annotate/**`, `packages/drawings-skills/**`, root `package.json` workspaces, `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Both packages stay `"private": true` — NO npm publish in this branch.
- Source extracted from the diag repo COMMITTED HEAD (`/home/antoinefa/src/radar-immobilier/mermaid-editor`); diag repo is READ-ONLY.
- No rewire of `annotate` comment store to `@sentropic/comments` (follow-up lot).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/annotate/**`
  - `packages/drawings-skills/**`
  - root `package.json` (`workspaces` only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - npm publication / `publishConfig` / OIDC trusted publisher config
  - the diag repo (`/home/antoinefa/src/radar-immobilier/mermaid-editor`)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- DEDUP-1 `attention`: `packages/annotate/src/comment-store.ts` (+ the comment types in `src/types.ts`) duplicate the published `@sentropic/comments` thread model. Per owner default, `@sentropic/annotate` is the GEOMETRY/CERCLAGE primitive only. Action taken: left in place + added a clear `@deprecated` note flagging deferral of thread lifecycle to `@sentropic/comments`. NOT rewired (follow-up lot).
- GATE-PUBLISH `deferred`: publishing both packages = human/escalation gate (bootstrap publish + OIDC trusted publisher). Out of scope here.
- GATE-REWIRE `deferred`: rewire `annotate` comment store → `@sentropic/comments` = follow-up lot.
- GATE-TOPOLOGY `deferred`: site topology (diag = site only; what diag imports from these packages) = architect decision.

## AI Flaky tests
- None (no AI-driven tests in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal centralization lot, two sibling packages, no cross-branch dependency.

## UAT Management (in orchestration context)
- No UI surface added to the running app in this branch (packages only, unpublished, not yet consumed by `ui/`/`api/`). No UAT checkpoint.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm source files exist in diag HEAD (`git ls-tree -r HEAD -- packages/annotate packages/drawings-skills`).
  - [x] Create feature branch `feat/canevas-libs-centralize`.
  - [x] Capture make targets for package typecheck/test.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Centralize packages**
  - [x] Extract `packages/annotate` + `packages/drawings-skills` from diag HEAD via `git archive HEAD | tar -x`.
  - [x] Wire into root npm workspaces (covered by existing `packages/*` glob — no root edit required).
  - [x] Keep `"private": true` in BOTH `package.json` (no publish).
  - [x] Confirm `drawings-skills` deps: `@sentropic/annotate` (workspace `*`), peers `svelte`/`mermaid`/`@codemirror/*`.
  - [x] DEDUP: add `@deprecated` note to `annotate/src/comment-store.ts` (defer thread lifecycle to `@sentropic/comments`); do NOT rewire.
  - [x] Lot gate: typecheck/test via Docker make pattern (record result or Docker-block error).

- [x] **Lot N — Final validation**
  - [x] Both packages private/unpublished.
  - [x] Dedup flag added + recorded here.
  - [x] Build/test result OR exact Docker-block error recorded in `## Feedback Loop` / report.
  - [x] Remaining gates recorded (publish / rewire / topology).
