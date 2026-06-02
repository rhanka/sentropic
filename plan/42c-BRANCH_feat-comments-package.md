# Feature: @sentropic/comments (BR-42c)

## Objective
Deliver the new standalone package `@sentropic/comments@0.1.0`: collaborative annotation (comments/threads) over messages, canvas, artifacts, fields and records — domain types + pure-TS guards, a `CommentStore` port, an in-memory reference adapter (thread-level cascade), transport-agnostic wire events, and a `CommentThreadSummary` package surface. No `api`/`ui` change (activation deferred to BR-42d). Finishes at typecheck + unit tests + build + pack green.

## Scope / Guardrails
- Scope limited to `packages/comments/**` plus the additive `*-comments` Makefile + CI lane (BR42c-EX1).
- No migration (no `api/drizzle/*.sql`).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-comments-package`.
- No service stack starts (package-only): no API/UI/Maildev ports required.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/comments/**`
  - `plan/42c-BRANCH_feat-comments-package.md` (this file)
  - `spec/SPEC_EVOL_COMMENTS.md` (already present; no further edit required)
  - `package-lock.json` (lockfile regen via `make lock-root`)
  - `Makefile` (additive `*-comments` lane only — BR42c-EX1)
  - `.github/workflows/ci.yml` (additive `comments` filters/validate/publish/bootstrap — BR42c-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - other `packages/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - other `plan/**` and `PLAN.md`
- **Conditional Paths (allowed only via explicit exception)**:
  - `Makefile` — granted under BR42c-EX1
  - `.github/workflows/ci.yml` — granted under BR42c-EX1
- **Exception process**:
  - `BR42c-EX1` declared below in `## Feedback Loop`.

## Feedback Loop
- BR42c-EX1 (`acknowledge`): touch `Makefile` + `.github/workflows/ci.yml`.
  - Reason: a publishable package is inert without its make + CI lane (typecheck/test/build/pack/publish targets and `validate-comments`/bootstrap CI entries).
  - Impact: additive-only; mirrors the verified `chat-server`/`chat-core` lanes line-for-line; no edits to existing targets.
  - Rollback: delete the added `*-comments` Makefile block and the `comments`/`comments_publish` CI entries.
- Activation note (`acknowledge`): BR-42c ships the package with NO consuming-app root. Per SPEC §8, activation (Postgres `CommentStore` adapter over the live `comments` table + `api/src/routes/api/comments.ts` adoption + workspace import) is deliberately carved into BR-42d (`feat/persistence-comments-observability`). This is a plan-sanctioned exception to `rules/architecture.md` ("Package extraction must be activated by real app consumption") — a sequenced two-branch activation (build → activate), not inert scaffolding.

## AI Flaky tests
- None. Nothing in this package is AI/flaky (all deterministic unit tests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: a single orthogonal package deliverable; no sub-workstreams requiring independent CI.

## UAT Management (in orchestration context)
- No UAT in BR-42c (no `ui` change, package-only). UAT belongs to BR-42d activation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Skeleton & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `spec/SPEC_EVOL_COMMENTS.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated worktree `tmp/feat-comments-package` (branch verified `feat/comments-package`).
  - [x] Create this `plan/42c-BRANCH_feat-comments-package.md` (record BR42c-EX1 + activation note).
  - [x] Create `packages/comments` skeleton mirroring `chat-server`/`chat-core`: `package.json` (`@sentropic/comments@0.1.0`, MIT, not-private, ESM, exports `.`), `tsconfig.json` (NodeNext), `LICENSE` (MIT), `README.md`.
  - [x] `make lock-root` (regenerate root `package-lock.json`).

- [x] **Lot 1 — Domain types + port** (`packages/comments/src/`)
  - [x] `CommentTarget` (`{ kind: message|canvas|artifact|field|record, id, sectionKey?, recordType? }`) + lossless round-trip with live `{ contextType, contextId, sectionKey }`.
  - [x] `Comment` (id, tenant, target, threadId, author identity ref, assignedTo?, state open|resolved, body, provenance.toolCallId?, createdAt, updatedAt).
  - [x] `CommentEvent` union (created|updated|resolved|reopened|deleted|reassigned) + `CommentEventSink` + `EventEnvelope<CommentEvent>` wrapper (from `@sentropic/contracts`).
  - [x] `CommentThreadSummary` (verbatim live fields: threadId, contextType?, target, sectionKey?, rootMessage, rootMessageAt, lastMessage, lastMessageAt, messageCount, status, assignee?).
  - [x] `CommentStore` port (tenant-scoped per `TenantContext`: add/get/edit(content)/setState(thread-cascade)/assign(thread-cascade)/delete(per-row hard)/listByTarget/listThread/listThreadSummaries + event sink).
  - [x] Pure-TS guards (NO zod). NO redaction. NO parentId.
  - [x] Lot gate: `make typecheck-comments ENV=feat-comments-package`.

- [x] **Lot 2 — In-memory adapter**
  - [x] `InMemoryCommentStore` implementing the port: CRUD, threadId minting on root + validation on reply, thread-level cascade for setState/assign, row-level content edit, per-row hard delete (root-delete leaves surviving replies), `createdAt ASC + id` deterministic ordering, tenant-scoping, wire-event emission on every mutation.
  - [x] Transport-agnostic (no Drizzle/PG/api imports).
  - [x] Lot gate: `make typecheck-comments ENV=feat-comments-package`.

- [x] **Lot 3 — Tests** (`packages/comments/tests/`, vitest node)
  - [x] `domain-schema.spec.ts` — guard parse/serialize + target round-trip (lossless).
  - [x] `in-memory-crud.spec.ts` — add/get/edit (per-row content) / delete (per-row hard, root-delete rule) / listByTarget filtering.
  - [x] `threading.spec.ts` — reply mint vs inherit threadId; ordering tiebreaker; reply-to-unknown-thread rejected.
  - [x] `thread-cascade.spec.ts` — setState/assign cascade across all thread rows; content edit row-level.
  - [x] `thread-summary.spec.ts` — listThreadSummaries shape matches verbatim live fields.
  - [x] `tenant-scoping.spec.ts` — cross-tenant isolation (security-critical).
  - [x] `wire-events.spec.ts` — every mutation emits the right CommentEvent incl. reassigned; no event on read.
  - [x] Lot gate: `make test-comments ENV=test-feat-comments-package`.

- [x] **Lot 4 — Make + CI lane (BR42c-EX1)**
  - [x] Makefile: `typecheck-comments`, `test-comments`, `build-comments`, `pack-comments`, `publish-comments`, `publish-comments-token` mirroring chat-server/chat-core.
  - [x] ci.yml: `comments`/`comments_publish` filters; `validate-comments` job; `publish-comments` (OIDC, on main); `bootstrap_publish_target` `comments` enum + bootstrap step.
  - [x] Lot gate: `make build-comments` + `make pack-comments` green; yaml-parse check.

- [x] **Lot N — Final validation (recette-ready)**
  - [x] `make typecheck-comments ENV=feat-comments-package` — GREEN
  - [x] `make test-comments ENV=test-feat-comments-package` — GREEN
  - [x] `make build-comments` — GREEN
  - [x] `make pack-comments` — GREEN
  - [ ] First publish (BR-42d / bootstrap): `workflow_dispatch bootstrap_publish_target=comments` then attach OIDC trusted publisher on npmjs.com (documented; not executed here).

## Deferred to BR-42d
- Postgres `CommentStore` adapter over the live `comments` table.
- `api/src/routes/api/comments.ts` adoption (replace inline Drizzle handlers).
- Workspace import from at least one app root (real-consumption activation).
- npm first-publish bootstrap + OIDC trusted publisher attach.
