# Feature: PDF/document annotation anchor over @sentropic/comments

## Objective
Enable a PDF/document annotation anchor through the existing @sentropic/comments backbone, host-side only — no package change, no schema migration. Adds an `artifact` comment context bound to `context_documents`, plus a host-only PDF-anchor `sectionKey` convention.

## Scope / Guardrails
- Scope limited to the host comments route + a host-side PDF-anchor helper and its unit test.
- No migration (`api/drizzle/*.sql` untouched) — reuses existing `comments` + `context_documents` tables.
- No `@sentropic/comments` package change — `kind:'artifact'` and verbatim `sectionKey` are already supported.
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/api/comments.ts`
  - `api/src/services/comments/**`
  - `api/tests/unit/pdf-anchor.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/comments/**`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `ui/**` (UI PDF-viewer annotation surface — deferred, see Feedback Loop)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `deferred`: UI annotation surface (PDF viewer embed + cerclage) is OUT OF SCOPE here — gated on the architect `@sentropic/pdf-*` packages and ARCH-22 cerclage. This branch ships only the host anchor backbone (route + sectionKey convention).
- `attention`: Project Docker/Make test runner unavailable in this environment (`permission denied ... docker.sock`); typecheck/test executed statically + via a dependency-free Node logic mirror. Re-run `make typecheck-api` + `make test-api-unit SCOPE=tests/unit/pdf-anchor.test.ts ENV=test-pdf-anchor` on a Docker-capable host before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal host-side change (one route + one helper + one unit test).

## Plan / Todo (lot-based)
- [x] **Lot 1 — Host route enablement (`api/src/routes/api/comments.ts`)**
  - [x] Add `'artifact'` to `contextTypeSchema`.
  - [x] Add an `artifact` branch to `ensureContextExists()` validating `context_documents` by `(id, workspaceId)` (false => 404).
  - [x] On POST, construct `CommentTarget{ kind:'artifact', id: docId, sectionKey }` directly (do NOT route through `targetFromLive`); `targetToLive` already handles `kind:'artifact'`.
  - [x] Verify GET filtering still matches (`recordType ?? kind`) — read-back `contextType='artifact'` => `recordType='artifact'` => filter matches.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-pdf-anchor` (blocked: docker.sock denied — see Feedback Loop)

- [x] **Lot 2 — sectionKey PDF-anchor convention (additive helper + unit test)**
  - [x] Add `api/src/services/comments/pdf-anchor.ts`: encode/decode `{ page, bbox? }` ⇄ canonical `pdf:p<page>[:bbox:<x0>,<y0>,<x1>,<y1>]` + validation (finite, 0..1, x1>=x0, y1>=y0, page>=1).
  - [x] Add `api/tests/unit/pdf-anchor.test.ts`: round-trip + validation (34 assertions; pass via dependency-free Node logic mirror).
  - [ ] Lot gate:
    - [ ] `make test-api-unit SCOPE=tests/unit/pdf-anchor.test.ts ENV=test-pdf-anchor` (blocked: docker.sock denied — see Feedback Loop)

- [ ] **Lot N — Final validation** (deferred to a Docker-capable host)
  - [ ] Typecheck & scoped unit test green on Docker host.
  - [ ] PR with this `BRANCH.md` as body; CI green; remove `BRANCH.md`; merge.
