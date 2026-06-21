# Feature: Resource Plane backend core (BR-70 / ARCH-21a — foundations slice)

## Objective
Build the foundations-owned backend of the resource plane (SPEC_EVOL_RESOURCE_FS, ARCH-21a, RF1-RF11 DECIDED): a canonical `ResourceRef`/etag, a `ResourceProvider` port carrying the full §3.3 verb contract (list/stat/read/grep/edit/invoke/watch with typed `unsupported`), a `ResourceDispatcher` (mount registry, ref+path-alias resolution, lazy root `ls`), a `CatalogResourceProvider` projecting `/tools /skills /agents /workflows /canvas` (list+read; MCP resources flow through automatically once the catalog lineage exposes them via BR-42i/j — BR-70 does NOT own the MCP mapping), and an authz-projected namespace (separate discover/read/invoke scopes, deny-as-missing, bounded pagination). Chat-coupled surfaces (resource_invoke bridge, /proc/jobs, /context/session) and chat-lane surfaces (chat-ui tree + RF11, LLM tool-family discovery→typed via chat-core ToolRegistry) are explicitly DEFERRED and coordinated with the chat lane.

## Scope / Guardrails
- Scope limited to a NEW `api/src/services/resource-plane/` subsystem + read-only adapters over the existing catalog; no schema migration.
- No behavior change to the catalog sources (esp. `metadata.name` — it feeds chat dispatch; changing it is a chat-coordinated breaking change).
- Make-only workflow; no direct Docker commands.
- Root `ENV=dev` reserved for the user; tests on `ENV=test-resource-plane-a`.
- `ENV=<env>` is the LAST arg of every `make` command.
- Ports (branch nn=70, slot 0): API `9350`, UI `5550`, Maildev UI `1450`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/resource-plane/**`
  - `api/tests/unit/resource-plane.test.ts` (the `unit` suite is a real CI shard; `tests/resource-plane/**` would NOT be run — see Feedback Loop)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/chat-core/**`, `packages/chat-server/**`, `packages/chat-ui/**` (chat lane)
  - any catalog source `metadata.name` / public-name derivation (chat dispatch depends on it)
- **Conditional Paths (allowed only with explicit BR70-EXn exception)**:
  - `api/src/services/catalog/**` — ADDITIVE read-only accessor ONLY (e.g. enumerate per-source/per-kind entries to bypass the composite dedup); never alters dedup/resolve behavior.
  - `api/drizzle/*.sql` (none expected)
  - `.github/workflows/**` (none expected)
- **Exception process**: declare `BR70-EXn` in `## Feedback Loop` before touching a conditional/forbidden path.

## Feedback Loop
- `acknowledge` (BR70-REV1 — dual adversarial consensus Codex 5.5-xhigh + Opus 4.8 on scope split + lots, applied):
  - Ownership split CONFIRMED: deferring resource_invoke / /proc/jobs / /context/session / chat-ui+RF11 / ToolRegistry-live-loop to chat lane is correct; the verb contract + RF6 provenance/trust + read/list envelopes are foundations (kept).
  - BLOCKER fixed: the `ResourceProvider` port carries the FULL verb set (list/stat/read/grep/edit/invoke/watch); unimplemented verbs return a typed `unsupported` envelope (no v2 break). Error set: `not_found`(=deny-as-missing) / `denied` / `provider_unavailable` / `cas_conflict` / `too_large` / `invalid_args` / `not_searchable` / `unsupported` / `ambiguous_alias`.
  - MAJOR fixed: project per-`(kind,sourceId)` from source snapshots, NOT `CompositeCatalogRegistry.list/get` (it globally dedupes by `metadata.name`, hiding `/skills` vs `/tools`).
  - MAJOR fixed: canonical id = `kind:sourceId:nativeStableKey`; do NOT use bare `metadata.name`.
  - MAJOR fixed: do NOT reuse `CatalogExecutionSeam` as the authz boundary (it trusts prior `SkillsToolRegistry` filtering) — build a fresh `ResourceAuthzProjector`.
  - MAJOR (Lot 2): MCP canonical id = raw tool-name / resource-URI, collisions suffixed by deterministic hash (not list order); added as a resource-plane id LAYER, NOT a mutation of catalog `metadata.name`.
  - MAJOR fixed: `list{limit,pageToken,maxDepth}→{entries,nextPageToken}`; `read{maxBytes}→{content,contentType,provenance,etag,truncated,summary?}`.
  - MINOR: `ResourceRef.scope` is server-verified against the request principal, never trusted from the caller.
- `acknowledge` (BR70-REHOME 2026-06-21): main moved ~25 PRs during a gap; `cf461f2fa` re-homed MCP to the catalog lineage (BR-42i/j) — BR-70 projects, not owns. Branch rebased onto current main (`2b972f3dc`); catalog APIs (`getSources`/`search`/singleton/`CatalogEntryKind`/`sourceId`) verified unchanged → Lot 1 holds unmodified. Lot 2 dropped. Reported + priority-checked with conductor.
- `attention` (BR70-CI1, CI coverage gap, FLAG to conductor): the CI `test-api-unit-integration` suites filter by fixed dirs (`tests/{smoke,unit,queue,ai,security,limit,api}`) and `api/vitest.config.ts` sets no `include`, so feature dirs `tests/{artifact-store,object-registry,outbox,services,resource-plane}` are NOT executed by any suite. BR-52/59/60 unit tests there appear to never run in CI (green-by-absence). I placed BR-70's test in `tests/unit/` to be covered. The systemic fix (wire those dirs into a suite + re-validate BR-52/59/60 tests) is a dedicated foundations CI PR, not this branch.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism (≥1 success same commit+command); never add timeouts; analyze vs `main` (unrelated→accept+record, related→blocking).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one cohesive backend subsystem; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Lots 1-2 are one foundations subsystem with no independent sub-workstream.

## UAT Management (in orchestration context)
- No UI surface in this branch → no interactive UAT; validation is API unit tests (the plane has no live wiring into routes/chat in v0; it is exercised by tests until the chat-lane LLM-tool-family lands).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read SPEC_EVOL_RESOURCE_FS (§2,3.1-3.3,4,6,8), `catalog/{source,types}.ts`, sources list.
  - [x] Dual consensus (Codex xhigh + Opus) on scope split + lots → BR70-REV1.
  - [x] Worktree `tmp/resource-plane-a` from `origin/main`; `cp ../../.env .env`.

- [ ] **Lot 1 — ResourceRef + ResourceProvider port + dispatcher + CatalogResourceProvider + authz**
  - [ ] `resource-plane/ref.ts`: `ResourceRef{provider,scope:ScopeMap,type,id,etag?}` + `res://` parse/format + `ScopeMap` (Sentropic `{tenantId,workspaceId}`).
  - [ ] `resource-plane/contract.ts`: verb contract types — `ListArgs{limit,pageToken,maxDepth}`/`ListResult{entries,nextPageToken}`, `ReadArgs{maxBytes}`/`ReadResult{content,contentType,provenance,etag,truncated,summary?}`, `ResourceError` union, `ResourceProvider` interface (all verbs; defaults → `unsupported`).
  - [ ] `resource-plane/provider-base.ts`: abstract base defaulting every verb to a typed `unsupported` result.
  - [ ] `resource-plane/dispatcher.ts`: mount registry; resolve ref AND path-alias; root `ls` returns mounts from cache (never sync fan-out); server-verifies `scope` from the request principal.
  - [ ] `resource-plane/authz.ts`: `ResourceAuthzProjector` — separate discover/read/invoke checks, deny-as-missing (`not_found`), bounded stable pagination; NOT `CatalogExecutionSeam`.
  - [ ] `resource-plane/providers/catalog-provider.ts`: `CatalogResourceProvider` — per-`(kind,sourceId)` projection of `/tools /skills /agents /workflows /canvas`; canonical id `kind:sourceId:name`; etag = stable content hash; `read` = schema+doc(+ref+etag); `edit`→`denied`; `grep`→delegates to `search_catalog`/`search_skills` (authz) or `not_searchable`.
  - [ ] `resource-plane/index.ts`: assemble dispatcher + catalog provider singleton.
  - [ ] **API tests** (`api/tests/resource-plane/`): ref parse/format round-trip; dispatcher mount + path/ref resolution + lazy root ls; authz discover≠read + deny-as-missing + pagination; catalog list per-kind (no cross-kind dedup collision) + read schema/etag + edit-denied + grep-delegation; unsupported-verb envelope.
  - [ ] Lot gate: `make typecheck-api lint-api ENV=test-resource-plane-a` + scoped `test-api` on `tests/resource-plane`.

- [x] **Lot 2 — DROPPED (MCP re-homed to catalog lineage)**: per `cf461f2fa`, MCP work moved to BR-42i (mcp-resources) + BR-42j (adapter); "BR-70 projects/consumes — not owns". The `CatalogResourceProvider` already projects every catalog entry uniformly, so MCP resources surfaced by BR-42i/j flow through the catalog mounts with no BR-70 code. No `mcp-provider.ts`. BR-70 is now a single-lot backend branch.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api).
  - [ ] `make test-api ENV=test-resource-plane-a` (full) + e2e non-regression (no live wiring → expect green).
  - [ ] PR with `BRANCH.md` as body; branch CI green; resolve blockers.
  - [ ] On CI green: `git rm BRANCH.md` commit, push, merge (D2 preprod-only).

## Deferred to chat-lane coordination (NOT this branch)
- `resource_invoke(ref,args,idempotencyKey)` + turn suspend/resume (`acceptLocalToolResult`/`resumeFrom`) + `/proc/jobs/<id>/{status,result}` — couples chat-core/chat-server runtime.
- `/context/session` + `/context/nav` — reads chat session fields.
- chat-ui resource tree + RF11 (file chips, terminal pane, custom-renderer slot).
- LLM tool-family: discovery `ls`/`read` → resolved TYPED tool via chat-core `ToolRegistry.resolve` (RF2).
