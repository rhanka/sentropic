# Feature: BR-17 — RAG on Document Folders

## BR-04 dependency note
No direct impact. BR-04 does not touch document model or processing pipeline. RAG works on `contextDocuments` regardless of workspace type. See `spec/SPEC_EVOL_WORKSPACE_TYPES.md` §15.3.

## Dependencies
- BR-16 (`feat/document-connectors`): optional — RAG works with local-only documents first, multi-source after BR-16.
- BR-08 (`feat/model-runtime-claude-mistral-cohere`): Cohere embeddings API as preferred embedding provider. Can use OpenAI embeddings as fallback if BR-08 not yet merged.

## Objective
Implement Retrieval-Augmented Generation on documents attached to contexts (folder, organization, initiative). When the LLM needs document context in chat, it retrieves semantically relevant chunks rather than injecting full document summaries.

## Scope / Guardrails
- Scope limited to: document chunking pipeline, vector embeddings (pgvector), retrieval API, `documents` tool semantic search mode, chat integration for top-K chunk injection.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-rag-documents`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-rag-documents` `API_PORT=8717` `UI_PORT=5117` `MAILDEV_UI_PORT=1017`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/17-BRANCH_feat-rag-documents.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required by the branch objective)
  - `docker-compose*.yml` (only if pgvector extension requires Docker config changes)
- **Exception process**:
  - Declare exception ID `BR17-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Questions / Notes
- RAG-Q1: pgvector vs external vector store (Pinecone, Qdrant) — preference for single-DB simplicity.
- RAG-Q2: Chunking strategy — fixed-size, semantic boundaries, or hybrid?
- RAG-Q3: Embedding provider — Cohere (BR-08), OpenAI, or configurable per workspace?
- RAG-Q4: Chunk size and overlap parameters — configurable per workspace type?
- RAG-Q5: Re-embedding strategy when documents are updated.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: RAG is additive to existing document pipeline, single progression.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-rag-documents`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-rag-documents` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-rag-documents` and environment mapping (`ENV=feat-rag-documents`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR17-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.
  - [ ] Design `document_chunks` table, embedding pipeline, and retrieval API.

- [ ] **Lot 1 — Chunking & Embedding Pipeline**
  - [ ] Enable pgvector extension on PostgreSQL.
  - [ ] Create `document_chunks` table (`id`, `document_id`, `chunk_index`, `content`, `embedding vector`, `metadata jsonb`).
  - [ ] Implement document chunking pipeline (extract → split → chunk).
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
  - [ ] Implement embedding generation via provider API (Cohere or OpenAI fallback).
  - [ ] Integrate into existing document processing job queue (post-summary step).
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-rag-documents`
    - [ ] `make lint-api ENV=test-feat-rag-documents`
    - [ ] `make test-api ENV=test-feat-rag-documents`

- [ ] **Lot 2 — Retrieval & Chat Integration**
  - [ ] Implement semantic search API (`POST /api/v1/documents/search` with query + context + top_k).
  - [ ] Extend `documents` tool with `semantic_search` mode (replaces summary-only retrieval in chat).
  - [ ] Update `buildChatGenerationContext()` to inject top-K relevant chunks instead of full summaries.
  - [ ] UI: search relevance indicator in document panel (optional).
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-rag-documents`
    - [ ] `make lint-api ENV=test-feat-rag-documents`
    - [ ] `make test-api ENV=test-feat-rag-documents`
    - [ ] `make typecheck-ui ENV=test-feat-rag-documents`
    - [ ] `make lint-ui ENV=test-feat-rag-documents`
    - [ ] `make test-ui ENV=test-feat-rag-documents`
    - [ ] `make build-api build-ui-image API_PORT=8717 UI_PORT=5117 MAILDEV_UI_PORT=1017 ENV=e2e-feat-rag-documents`
    - [ ] `make clean test-e2e API_PORT=8717 UI_PORT=5117 MAILDEV_UI_PORT=1017 ENV=e2e-feat-rag-documents`

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
