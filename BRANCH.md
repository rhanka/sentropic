# Feature: BR-62 Lot A — repatriate `@sentropic/annotate` as a spatial-only substrate

## Objective
Bring the annotation module out of the `rhanka/diag` incubator into `sentropic/packages/` per the
ratified `SPEC_VOL_INTERACTIVE_CANVAS` I6 ("lift the cerclage/annotation primitive OUT of diag into a
reusable canvas module") and D8 (diag stays in the monorepo). Owner-ratified 2026-07-25: repatriate
**annotate ALONE** (R1=C), as a **spatial-only** package with a **thin host-bound port and NO hard
dependency on `@sentropic/comments`** (R2), attached to **BR-62** (R3), from the **PR#4 subtree at a
frozen SHA** (F2). All four decisions came from double adversarial review (Opus 4.8 xhigh +
Codex 5.6-terra xhigh, CONVERGED).

## Scope / Guardrails
- Repatriation + de-duplication only. No consumer wiring, no CI publish lane in this lot.
- Source is FROZEN at `rhanka/diag` `0a19f68726a0028cae3b63329538707738843b16` (subtree
  `packages/annotate` of the unmerged PR#4 branch; the branch tip `f402c40` is subtree-identical since
  no later commit touches the package). The SHA is recorded so the provenance is auditable.
- Make-only workflow; `ENV` last. Tests on `ENV=test-annotate`, never on root `dev`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/annotate/**` (repatriated package)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `api/**`, `ui/**`, `apps/**`, other `packages/**`, `spec/**`, `PLAN.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — used, see `BR-62-EX1`.
- **Exception process**: declare `BR-62-EXn` in `## Feedback Loop` before touching any
  conditional/forbidden path.

## Feedback Loop
- `BR-62-EX1` (`Makefile`, exercised): added a `test-annotate` target. Rationale: the package cannot be
  verified otherwise — the repo-wide workspace install is currently broken (npm cache permission error
  in-container), and the established package-test pattern is a self-contained docker target. Impact:
  additive only, copied LINE BY LINE from the existing `test-comments` target with only the package name
  and directory substituted (no new pattern invented). Rollback: delete the target block.
- `BR-62-N1` (`blocked`, architecture rule): `rules/architecture.md` requires "Package extraction must be
  activated by real app consumption. A new package is not accepted as architecture-only scaffolding: the
  owning branch must prove at least one app root imports it through workspace wiring." **There is no
  annotate consumer in sentropic today** — the canvas host that would mount it is ARCH-16/ARCH-22, both
  deferred by the ratified R1=C. Opus flagged the same risk. So this lot MUST NOT merge as-is; it needs
  either (a) a real consuming surface, or (b) an explicit, owner-ratified exception to that rule.
  **Raised rather than papered over.**
- `BR-62-N2` (`attention`): the publish lane (dist build, publish-time src→dist manifest rewrite, CI
  `validate-`/`publish-` jobs, bootstrap) is NOT in this lot. It is mechanical and mirrors
  `packages/cited-source-viewer` (`scripts/make-publish-pkgjson.mjs` + the `ci.yml` lanes), and it should
  land only once `BR-62-N1` is resolved — publishing a package no app consumes is exactly what the
  architecture rule forbids.
- `BR-62-N3` (`acknowledge`, residual from the F2 review): both evaluators noted work that survives the
  R2 rewrite and is NOT done here — the overlay still delegates layout to host Tailwind utility classes
  (`pointer-events-none absolute inset-0 …`, pin geometry), so the package currently renders correctly
  only inside a Tailwind host. Folding that geometry into the component `<style>` is required before
  publishing. The `--st-color-*` token names inherited from diag DS `0.34.42` are also unverified against
  sentropic's pinned DS, and a name miss degrades SILENTLY through the hex fallback.
- `BR-62-N4` (`acknowledge`): dead CSS from the excised composer (`annot-composer*` / `annot-btn*`) is
  still present in the overlay and must be deleted rather than shipped, per the same review.

## AI Flaky tests
- No AI generation surface touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal repatriation lot.

## UAT Management (in orchestration context)
- No app surface yet (see `BR-62-N1`). UAT = architect review of the seam and of the de-duplication.
  Browser UAT only becomes meaningful once a host mounts the overlay.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Frozen import**
  - [x] Extract `packages/annotate` from diag at `0a19f687` via `git archive` (no history rewrite,
        no cross-repo merge).
  - [x] Confirm the 13 imported files.

- [x] **Lot 1 — Apply R2 (spatial-only)**
  - [x] `src/types.ts`: delete the `Comment` / `CommentStatus` / `CommentAuthor` / `CommentQuery` /
        `CommentUpdate` / `AddCommentInput` / `CommentStore` block; introduce `AnnotationRecord`,
        `NewAnnotation`, `AnnotationPort`; document WHY the domain lives in `@sentropic/comments`.
  - [x] `AnnotateContext.comments: CommentStore` → `annotations: AnnotationPort`; drop `createdBy`
        (identity is the host's, not this package's).
  - [x] Replace `src/comment-store.ts` with `src/annotation-port.ts`
        (`createInMemoryAnnotationPort`, `annotationsForAI` carrying `origin`).
  - [x] `src/svelte/AnnotationLayer.svelte`: rewire onto the port; `sectionKey` → `anchorKey`
        (the host maps it to `CommentTarget.sectionKey`); `sectionKeyOf` → `anchorKeyOf`.
  - [x] `src/index.ts`: re-export the port; state the boundary in the barrel.

- [x] **Lot 2 — Publish-readiness (manifest)**
  - [x] `package.json`: sentropic conventions (repository+directory, `main`/`types`, `svelte` export
        condition, `./AnnotationLayer.svelte` subpath), description rewritten to the real scope.
  - [x] `svelte` peer is now REQUIRED — it was wrongly marked `optional`, while the overlay needs it.
  - [x] `tsconfig.json`: drop the diag-only `extends ../../tsconfig.base.json` (absent here) and adopt
        the `packages/comments` convention.

- [x] **Lot 3 — Tests**
  - [x] `tests/annotation-port.test.ts` (9 cases): open-only listing, thread minting vs preservation,
        subscribe/unsubscribe, verbatim anchor pass-through, origin defaulting, the AI projection shape,
        the non-laundering of machine provenance, resolved omission, and that the projection works
        against ANY `AnnotationPort` (not just the in-memory adapter).
  - [x] Delete `tests/comment-store.test.ts` along with the domain it tested.

- [ ] **Lot 4 — Blocked / next**
  - [ ] Resolve `BR-62-N1` (consumer or ratified exception) — blocking for merge.
  - [ ] `BR-62-N3` / `BR-62-N4`: internalize layout, verify DS token names, delete dead composer CSS.
  - [ ] Publish lane (`BR-62-N2`), only after N1.

## Checks (results)
- `make test-annotate ENV=test-annotate` — **18/18 PASS** (`tests/geometry.test.ts` 9, inherited from
  diag and unchanged; `tests/annotation-port.test.ts` 9, new).
- Grep-verified after the rewrite: no `CommentStore`, no `Comment` interface, and no `sectionKey`
  identifier remain in the package — only a comment explaining the host mapping.
- Provenance recorded: source SHA `0a19f68726a0028cae3b63329538707738843b16`.

## Notes
- E2E / UI / API tests: N/A (no app surface yet — `BR-62-N1`).
- The de-duplication is the point: annotate previously shipped its own `Comment` + `CommentStore`, which
  collided with `@sentropic/comments` (already carrying the `canvas`/`artifact` target kinds D9 requires).
  Two competing comment models would have had to be reconciled later, breakingly.
- The seam keeps annotate SYNCHRONOUS and tenant-agnostic on purpose: the comments package is async and
  requires `TenantContext`, while the overlay must render in an anonymous-first surface where a guest has
  no tenant. Holding that impedance on the host side is what lets this stay a pure UI substrate.
