# Feature: BR-42a0 Chat-Server (`@sentropic/chat-server` wire+turn library)

## Objective
Librarise the chat wire server + turn engine into `@sentropic/chat-server` (a port/adapter lib over
`@sentropic/chat-core`) and migrate the current `api/` onto it as the first client, with ZERO regression
and ZERO legacy (no dual paths). Prerequisite of BR-42a1 `feat/build-app-cli` (D5 SPLIT).

## Scope / Guardrails
- Scope limited to: the new `packages/chat-server/**` package, and the `api/` migration that re-points the
  chat WIRE + turn implementation onto it (PG adapter), plus the publish-lane wiring
  (`Makefile` + `.github/workflows/ci.yml`) under the granted `BR42a0-EX1`.
- No `api/drizzle/*.sql` migration (chat-server extraction MUST NOT change the DB schema).
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-chat-server`.
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-server/**` (new: `@sentropic/chat-server`, wire routes + ports + adapters; NO Drizzle/PG/presence imports)
  - `api/package.json` (add the `@sentropic/chat-server` workspace dependency)
  - `api/tests/**` (characterization/baseline suite + chat-server mount non-regression tests)
  - `package-lock.json` (root lockfile regen for the new workspace package)
  - `plan/42a0-BRANCH_feat-chat-server.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**` (the current app KEEPS its public contract — D7 option ii — so NO client change)
  - `api/drizzle/*.sql` (no migration — extraction is schema-neutral)
  - `packages/chat-core/**` (chat-core is consumed as-is; if a missing export surfaces it is a blocker, not an edit here)
  - other `plan/NN-BRANCH_*.md` (except this file)
  - `plan/42-BRANCH_chore-scale-build-app.md`, `plan/42a-BRANCH_feat-build-app-cli.md`, `PLAN.md`
    (umbrella status updates land on a docs pass, not here — see BR42a0-Q3)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/src/routes/api/chat.ts` — requires `BR42a0-EX2` (chat wire handler bodies leave api → chat-server)
  - `api/src/routes/api/streams.ts` — requires `BR42a0-EX2` (chat-stream SSE slice only; other 9 channels stay app-local)
  - `api/src/routes/api/index.ts` — requires `BR42a0-EX2` (mounting only, if route wiring shifts)
  - `api/src/services/chat-service.ts` — requires `BR42a0-EX2` (becomes/wraps the PG generation adapter — moved, NOT deleted-as-legacy)
  - `api/src/services/queue-manager.ts` — requires `BR42a0-EX2` (queue port PG adapter; `runAssistantGeneration` call site)
  - `api/src/services/stream-service.ts` — requires `BR42a0-EX2` (StreamBuffer/NOTIFY PG adapter seam)
  - `api/Dockerfile` — requires `BR42a0-EX3` (copy `packages/chat-server/package.json` before workspace install)
  - `Makefile` — requires `BR42a0-EX1` (publish-lane targets for `chat-server`)
  - `.github/workflows/ci.yml` — requires `BR42a0-EX1` (path filters + bootstrap enum + validate/publish jobs + `api` filter add)
- **Exception process**:
  - Declare exception ID `BR42a0-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Actions with the following status should be included around tasks only if really required.
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

- **D2 (BR42a-E)** `acknowledge` — RATIFIED Option 1 (SPEC §8): extract `@sentropic/chat-server` NOW from
  the app-local wire server; BOTH the generated app (BR-42a1) AND the existing `api/` consume it. Supersedes
  the SPEC §5.2-E template-owned préconisation.
- **D5 (plan gate)** `acknowledge` — RATIFIED SPLIT (SPEC §8 addendum): `@sentropic/chat-server` + the full
  `api/` migration are THIS prerequisite branch, sequenced BEFORE BR-42a1. BR-42a1 consumes the published,
  0-regression-proven `@sentropic/chat-server`.
- **D7 (route layer)** `acknowledge` — RATIFIED option ii (SPEC §8 addendum): chat-server exposes a
  CONFIGURABLE route layer. The current app mounts its EXISTING contract
  (`POST /chat/messages`, `GET /streams/sse?streamIds=<assistantMessageId>`,
  `GET /chat/sessions/:id/{messages,bootstrap}`) → no `ui/**` change, minimal regression. The generated app
  (BR-42a1) mounts the chat-ui CANONICAL routes (`/chat/sessions/:id/{messages,stream,bootstrap}`). Only the
  legacy IMPLEMENTATION (handler/turn bodies) is removed; converging the current app's route SHAPES onto
  canonical is a later, optional step (NOT in scope here).
- **D-must-add (generation/queue/stream port set)** `acknowledge` — RATIFIED (SPEC §8 addendum): chat-server
  defines an explicit generation/queue/stream PORT set; `runAssistantGeneration` (today in
  `api/src/services/chat-service.ts:2916`, invoked by `queue-manager.ts:3561` `processChatMessage` for job
  type `chat_message`) + the job queue + the NOTIFY stream live behind those ports. PG adapter for `api/`;
  in-memory synchronous-pump adapter for the generated app. The package imports NO Drizzle/PG/presence.
- **"0 legacy" clarified** `acknowledge` — Remove the duplicate chat-WIRE/turn implementation in `api/`
  (handler + turn bodies → chat-server ports). The PG/NOTIFY/presence code PERSISTS as the chat-server PG
  adapter (moved/wrapped, NOT deleted). The other 9 non-chat NOTIFY channels
  (job/organization/folder/initiative/lock/presence/workspace/workspace_membership/comment) stay app-local
  in `api/src/routes/api/streams.ts`. NO additive "keep legacy routes" escape hatch.
- **BR42a0-EX1** `acknowledge` (Makefile + `.github/workflows/ci.yml`) — GRANTED (D3/D5). For `chat-server`:
  add `typecheck-chat-server`, `test-chat-server`, `build-chat-server`, `pack-chat-server`,
  `publish-chat-server` (OIDC), `publish-chat-server-token` (bootstrap), mirroring the
  `chat-ui`/`cowork-bridge` targets line-for-line (`packages/chat-server` workdir; node-env Vitest;
  standalone-symlink pattern). In `ci.yml`: add `chat_server`/`chat_server_publish` path filters (mirroring
  the `chat_core` shapes, lines ~192-203), ONE entry in the `bootstrap_publish_target` enum (currently
  `none|contracts|events|chat-core|chat-ui|auth-hono|auth-ui|flow|cowork-bridge|cowork-desktop|all`), one
  `validate-chat-server` job, one steady-state OIDC `publish-chat-server` job (fires on `github.ref==main`),
  one bootstrap step in the dispatch job. **CRITICAL (SPEC §8 addendum):** the `api` changes filter
  (ci.yml lines ~122-127, currently `api/**` + `package.json` + `package-lock.json` + `packages/llm-mesh/**`
  + `packages/flow/**`) MUST ALSO include `packages/chat-server/**` so api unit/integration + e2e rerun when
  chat-server changes. Reason: a publishable package cannot ship without its lane, and api consumes it.
  Impact: additive targets/filters/enum/jobs only + one line in the `api` filter; no change to other
  packages' lanes. Rollback: remove the added targets/filters/enum entry/jobs, the `api`-filter line, and
  the package dir.
- **BR42a0-EX2** `acknowledge` (api chat-wire migration scope) — GRANTED. The migration touches the
  Conditional `api/` files above (`chat.ts`, `streams.ts`, `index.ts`, `chat-service.ts`, `queue-manager.ts`,
  `stream-service.ts`). Reason: D2/D7 require the chat WIRE+turn bodies to leave `api/` into chat-server
  ports, with `api/` wiring the PG adapter. Impact: chat handler/turn bodies move; the PG/NOTIFY/presence
  logic is re-homed as the PG adapter (no behavioural change); the 9 non-chat NOTIFY channels stay in
  `streams.ts`. Rollback: revert the api files to baseline (the package becomes an unused workspace dep).
  GATE: the Lot 1 characterization suite must stay green across the whole migration (0-regression contract).
- **BR42a0-EX3** `acknowledge` (api Dockerfile workspace manifest copy) — GRANTED. Reason: once
  `api/package.json` declares `@sentropic/chat-server` as a local workspace dependency, the API Docker build
  must copy `packages/chat-server/package.json` before `npm ci --workspaces --include-workspace-root`, matching
  the existing manifest-copy pattern for `auth-hono`, `llm-mesh`, and `flow`. Impact: additive Docker build
  metadata only; no runtime route or schema change. Rollback: remove the Dockerfile copy line and the API
  dependency entry.
- **BR42a0-E1** `attention` (extraction boundary — THE central risk). VERIFIED FACTS:
  - chat-ui default transport (`packages/chat-ui/src/client/transport.ts`) calls
    `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream` (SSE, forwards `fromSeq`),
    `GET /chat/sessions/:id/bootstrap`.
  - The current `api/` does NOT serve that exact contract: `chat.ts` serves `GET /sessions/:id/messages`
    + `GET /sessions/:id/bootstrap` + `POST /messages` (sessionId in body) + many turn-control routes
    (`/messages/:id/{stop,steer,feedback,retry,tool-results}`, `PATCH /messages/:id`,
    `/sessions/:id/checkpoints[...]`, `/sessions/:id/history`, `/messages/:id/runtime-details`,
    `/tool-permissions`); the chat SSE stream is `GET /streams/sse?streamIds=<assistantMessageId>` in
    `streams.ts` (NOT `/sessions/:id/stream`).
  - The real wire+turn server is split across `chat.ts`, `streams.ts`, `services/chat-service.ts`,
    `services/queue-manager.ts`, `services/stream-service.ts`, all Drizzle/PG-queue/presence-coupled.
  - `@sentropic/chat-core` exports `ChatRuntime` + the port interfaces (`MessageStore`/`SessionStore`/
    `StreamBuffer`/`CheckpointStore`/`StreamSequencer`/`MeshDispatch`) and `InMemory.{InMemoryMessageStore,
    InMemorySessionStore, InMemoryStreamBuffer, InMemoryCheckpointStore, InMemoryMeshDispatch,
    InMemoryStreamSequencer}` (VERIFIED via `packages/chat-core/src/index.ts` + `in-memory/index.ts`; the
    SPEC §4.1 claim that `InMemoryMeshDispatch` does NOT exist is WRONG — record the correction in docs).
  - Decision: `@sentropic/chat-server` exposes a `createChatServer(deps, { routes })` mountable Hono router
    factory where `routes: 'app-contract' | 'canonical'` (D7). `deps` = the chat-core ports +
    generation/queue/stream ports. `api/` mounts `routes: 'app-contract'` with PG adapters; BR-42a1's
    generated app mounts `routes: 'canonical'` with in-memory adapters. Turn-control routes
    (stop/steer/retry/tool-results/feedback/checkpoints/edit/history/runtime-details) belong to chat-server
    under both shapes (their bodies leave api). `/tool-permissions` is app-domain (extension permissions,
    Drizzle table) → STAYS app-local in `api/` (NOT in chat-server). Confirm the app-domain vs chat-server
    split of each chat.ts route at Lot 0.
- **BR42a0-E2** `attention` (streams.ts scope containment). `streams.ts` multiplexes 10 NOTIFY channels:
  `stream_events` (chat + classic generations), `job_events`, `organization_events`, `folder_events`,
  `initiative_events`, `lock_events`, `presence_events`, `workspace_events`, `workspace_membership_events`,
  `comment_events`. ONLY the chat-stream slice (`streamId == assistantMessageId`, the chat path of
  `stream_events`) is in scope for extraction behind the StreamBuffer/StreamSequencer ports. The other 9
  channels (and non-chat `stream_events` such as `organization_`/`folder_`/`initiative_`/`job_` prefixed
  stream ids) MUST stay app-local. Préco: chat-server serves the canonical `GET /chat/sessions/:id/stream`
  from its StreamBuffer port; for the app-contract shape, the existing `GET /streams/sse?streamIds=` stays
  in `api/streams.ts` and delegates ONLY the chat-stream draining to a chat-server-provided handler/port
  (the multiplexer + the 9 other channels remain in `streams.ts`). Confirm the delegation seam at Lot 0.
- **BR42a0-Q1** `attention` (queue/generation port shape). `runAssistantGeneration` is invoked
  asynchronously via the PG job queue (`queue-manager.processChatMessage`, type `chat_message`). chat-server
  must define a GenerationPort + QueuePort so: PG adapter = enqueue a `chat_message` job (current behaviour,
  zero change); in-memory adapter = a synchronous pump that runs the generation inline (no DB queue) for the
  generated app. Question: does the canonical `POST /chat/sessions/:id/messages` return BEFORE generation
  (async, like api today) or pump synchronously then stream? Préco: the route always enqueues via the
  QueuePort and returns the assistant message id; the in-memory QueuePort's "enqueue" runs the generation on
  the next tick and writes to the in-memory StreamBuffer (so SSE still streams). Resolve at Lot 0.
- **BR42a0-Q2** `attention` (single-branch confirmation). This branch is the prerequisite half of the D5
  split; it stands alone (its own CI, its own PR) and MUST be merged+published before BR-42a1 starts. Confirm
  the publish-before-a1 sequencing at Lot 0 (BR-42a1 pins `@sentropic/chat-server ^0.1.x`).
- **BR42a0-Q3** `attention` (plan/PLAN umbrella sync). `plan/42-BRANCH_chore-scale-build-app.md` + `PLAN.md`
  must record the D5 split (BR-42a0 then BR-42a1). Préco: land on a tiny separate docs commit/branch to keep
  `plan/**` cross-branch churn off this feature branch (Forbidden Paths above). Confirm owner at Lot 0.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in this file; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- The chat-server in-memory roundtrip + the api characterization suite route through a deterministic stub
  adapter / fixtures and MUST NOT be flaky; any nondeterminism there is a bug, never an allowlisted flake.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single feature branch `feat/chat-server`, internal lots 0..4; one final test cycle)
- [ ] **Multi-branch**
- Rationale: the lots are sequentially coupled (characterization tests must lock behaviour BEFORE the
  package is built; the package must exist BEFORE the `api/` migration; the migration must be green BEFORE
  the publish lane). A single branch gives one CI cycle and avoids version-sync churn. Sub-agents may take
  orthogonal sub-lots in slots 0..4, integrated on this branch.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after Lot 3 (the `api/` chat non-regression).
- UAT checkpoints listed as checkboxes inside the relevant lots (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-chat-server`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`): the monorepo chat still
    works end-to-end (send/stream/bootstrap/stop/steer/retry/tool-results/feedback/checkpoints) after the
    extraction.
  - Switch back to `tmp/feat-chat-server` after UAT.

## Wave & Port Allocation (branch nn = 42)
- Slot ports: API `9000 + (42*5) + slot` = `9210..9214`; UI `5200 + (42*5) + slot` = `5410..5414`;
  Maildev UI `1100 + (42*5) + slot` = `1310..1314`.
- Slot 0 (default lot owner): `API_PORT=9210`, `UI_PORT=5410`, `MAILDEV_UI_PORT=1310`, `ENV=feat-chat-server`.
- Before launching any sub-agent: `make ps-all` to verify no port conflict.
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline, scoping & EX declaration + package skeleton**
  - [x] Verify branch: `git -C tmp/feat-chat-server branch --show-current` = `feat/chat-server`.
  - [x] Create/confirm isolated worktree `tmp/feat-chat-server` from `main`; copy `.env`, override
        `ENV=feat-chat-server` + slot-0 ports (9210/5410/1310).
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`,
        `rules/security.md`, `PLAN.md`, `spec/SPEC_EVOL_BUILD_APP_CLI.md` (esp. §8 RATIFIED + addendum),
        §6 tests, §7 sequencing, `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §16`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Validate scope boundaries; record `BR42a0-EX1` (Makefile + ci.yml) and `BR42a0-EX2` (api migration) in `## Feedback Loop`.
  - [x] Resolve `BR42a0-E1` (per-route app-domain vs chat-server split of `chat.ts`; `/tool-permissions` stays app-local),
        `BR42a0-E2` (streams.ts chat-slice delegation seam), `BR42a0-Q1` (queue/generation port shape +
        sync-pump semantics), `BR42a0-Q2` (publish-before-a1), `BR42a0-Q3` (plan/PLAN sync owner).
  - [x] Create `packages/chat-server` skeleton: `package.json` (`@sentropic/chat-server`, `license: "MIT"`,
        `version: "0.1.0"`, NOT `private`; depends on `@sentropic/chat-core` + `hono`; peer/runtime on
        `@sentropic/llm-mesh` via the MeshDispatch port only), `tsconfig.json`, `LICENSE` (MIT), `README.md`.
  - [x] Confirm chat-core in-memory adapter availability (VERIFIED at scoping: `InMemory.*` barrel exports all
        six adapters incl. `InMemoryMeshDispatch`; record the SPEC §4.1 correction for the Lot N-1 docs pass).
  - [x] Regenerate the root lockfile for the new workspace package (`make lock-root`).

- [ ] **Lot 1 — Characterization / baseline tests FIRST (lock current behaviour)**
  - [x] Add `api/tests/api/chat-characterization.spec.ts` capturing the CURRENT chat flow against the CURRENT
        api routes (NO refactor yet — these tests must pass on baseline `main` behaviour): POST a message
        (`POST /chat/messages` with sessionId in body) → assistant placeholder + job enqueued; SSE over
        `GET /streams/sse?streamIds=<assistantMessageId>` streams deltas + a `done`; `GET /sessions/:id/bootstrap`
        + `GET /sessions/:id/messages` return seeded state; stop (`POST /messages/:id/stop`); steer
        (`POST /messages/:id/steer`); retry (`POST /messages/:id/retry`); tool-results
        (`POST /messages/:id/tool-results`); feedback (`POST /messages/:id/feedback`); checkpoints
        (`POST/GET /sessions/:id/checkpoints` + restore). Assert payload shapes verbatim (the regression oracle).
  - [x] Verify the existing chat-related api tests still pass on baseline (inventory `api/tests/api/chat-*`
        + any `streams*` specs); record the exact file list as the non-regression set:
        `api/tests/api/chat-bootstrap-contract.test.ts`,
        `api/tests/api/chat-characterization.spec.ts`,
        `api/tests/api/chat-checkpoint-contract.test.ts`,
        `api/tests/api/chat-feedback.test.ts`,
        `api/tests/api/chat-history-analyze-tool.test.ts`,
        `api/tests/api/chat-message-actions.test.ts`,
        `api/tests/api/chat-permissions.test.ts`,
        `api/tests/api/chat-summary-contract.test.ts`,
        `api/tests/api/chat-tools.test.ts`,
        `api/tests/api/chat.test.ts`,
        `api/tests/api/queue-stream-bootstrap-contract.test.ts`,
        `api/tests/api/streams.test.ts`.
  - [ ] Lot gate:
    - [x] Scoped characterization gate:
          `make test-api-endpoints SCOPE=tests/api/chat-characterization.spec.ts API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-feat-chat-server`
          — PASS (3 tests).
    - [x] Scoped chat/streams non-regression set:
          `make test-api-endpoints SCOPE='tests/api/chat.test.ts tests/api/chat-bootstrap-contract.test.ts tests/api/chat-characterization.spec.ts tests/api/chat-checkpoint-contract.test.ts tests/api/chat-feedback.test.ts tests/api/chat-history-analyze-tool.test.ts tests/api/chat-message-actions.test.ts tests/api/chat-permissions.test.ts tests/api/chat-summary-contract.test.ts tests/api/chat-tools.test.ts tests/api/queue-stream-bootstrap-contract.test.ts tests/api/streams.test.ts' API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-feat-chat-server`
          — PASS (12 files, 57 tests).
    - [x] `make typecheck-api` + `make lint-api`
          — PASS after the initial api mount/type-narrowing fixes (`lint-api` exits 0; existing console warnings remain).
    - [ ] Sub-lot gate: `make test-api ENV=test-feat-chat-server` (characterization suite green on baseline behaviour).

- [ ] **Lot 2 — Build `@sentropic/chat-server` (routes + ports + adapters, NO PG imports)**
  - [ ] Define the generation/queue/stream PORT set in `packages/chat-server/src/ports/**`: GenerationPort
        (runs a turn = `runAssistantGeneration`-equivalent over `ChatRuntime`), QueuePort (enqueue/cancel a
        chat turn), StreamPort (append/read/subscribe over chat-core `StreamBuffer`/`StreamSequencer`).
        Package imports NO Drizzle/PG/presence.
  - [ ] Export `createChatServer(deps, { routes: 'app-contract' | 'canonical' })` — a mountable Hono router
        factory (D7 configurable route layer). `deps` = chat-core ports (`MessageStore`/`SessionStore`/
        `StreamBuffer`/`CheckpointStore`/`StreamSequencer`/`MeshDispatch`) + the generation/queue/stream ports.
    - [x] `routes: 'canonical'` serves `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream`
          (SSE, `fromSeq` honoured), `GET /chat/sessions/:id/bootstrap` + the turn-control routes.
    - [x] `routes: 'app-contract'` serves the current app contract (`POST /chat/messages` sessionId-in-body,
          `GET /chat/sessions/:id/{messages,bootstrap}`) + the turn-control routes; the chat SSE slice is
          exposed as a handler/port the app's `/streams/sse` multiplexer can delegate to (BR42a0-E2).
      - [x] Initial `app-contract` HTTP route shape landed (`POST /chat/messages`, messages/bootstrap, turn-control routes).
      - [x] App-contract `/streams/sse` chat-slice delegation handler landed via `readAppContractStreamEvents`.
  - [ ] Provide an in-memory/stub GenerationPort + QueuePort (synchronous pump per BR42a0-Q1) + wire the
        chat-core `InMemory.*` stores so the package is runnable with zero infra (used by BR-42a1's generated app).
      - [x] Deterministic high-level in-memory adapter landed for POST → stream replay → bootstrap.
      - [ ] Replace/align high-level in-memory adapter with chat-core `InMemory.*` ports.
  - [ ] Lot gate:
    - [x] `make typecheck-chat-server`
    - [ ] **chat-server unit tests** (`packages/chat-server/tests/**`):
      - [x] `tests/wire-contract.spec.ts` — assert BOTH route shapes mount correctly; canonical serves exactly
            the three chat-ui transport routes (+ turn-control); app-contract serves the current app routes;
            both REJECT the unimplemented `/sessions/:id/events?fromSeq=N` replay endpoint and the
            `Sec-Sentropic-Wire-Version` header (study-spec futures, not shipped).
      - [ ] `tests/in-memory-roundtrip.spec.ts` — `POST messages` → SSE `stream` streams an assistant reply
            via the in-memory GenerationPort + `InMemoryMeshDispatch` + a deterministic stub adapter;
            `bootstrap` returns seeded messages; stop/steer/retry/tool-results/feedback/checkpoints exercised
            over in-memory adapters. Determinism asserted (no timestamps/random in payload shape).
        - [x] Initial deterministic POST → SSE replay → bootstrap coverage landed.
        - [x] Extended coverage to stop/steer/retry/tool-results/feedback/checkpoints.
        - [ ] Align the adapter with chat-core in-memory ports / `InMemoryMeshDispatch`.
      - [x] `tests/ports-contract.spec.ts` — `createChatServer` rejects missing/invalid port deps and an
            unknown `routes` value.
      - [x] Scoped runs: `make test-chat-server` (Vitest, node env, standalone-symlink pattern like cowork-bridge)
            — PASS (3 files, 9 tests).
    - [x] `make build-chat-server` + `make pack-chat-server` (tarball excludes tests/fixtures).
    - [x] Bump `packages/chat-server/package.json` to `0.1.0`.

- [ ] **Lot 3 — Migrate `api/` as first client in ONE cut (PG adapter; 0 regression, 0 legacy)**
  - [ ] Build the PG adapters in `packages/chat-server` consumers OR in `api/` that satisfy the chat-server
        ports from the EXISTING logic: `chat-service.ts` (generation/turn) becomes the GenerationPort PG
        adapter; `queue-manager.ts` (`processChatMessage`/`addJob`/`cancelJob`) becomes the QueuePort PG
        adapter; `stream-service.ts` + the chat slice of `streams.ts` become the StreamPort PG adapter.
        The PG/NOTIFY/presence code is MOVED/WRAPPED, NOT deleted-as-legacy.
  - [ ] Re-point the chat WIRE+turn handler bodies: `api/src/routes/api/chat.ts` mounts
        `createChatServer(pgAdapters, { routes: 'app-contract' })` for the chat session/message/bootstrap +
        turn-control routes (handler BODIES leave `chat.ts`). `/tool-permissions` stays app-local (app-domain).
    - [x] Initial `api/src/routes/api/chat.ts` mount landed for `POST /messages` +
          `GET /sessions/:id/{messages,bootstrap}` using `chatService` + `queueManager` adapters.
    - [x] Turn-control routes (`stop`, `steer`, `feedback`, `retry`, `tool-results`, checkpoints) now route
          through the chat-server mount with API adapters and authorization hooks.
  - [x] `api/src/routes/api/streams.ts`: keep the 10-channel multiplexer + the 9 non-chat channels app-local;
        delegate ONLY the chat-stream draining slice to the chat-server StreamPort handler (BR42a0-E2). No
        org/folder/initiative/lock/presence/workspace/comment logic moves into the package.
  - [x] REMOVE the now-duplicated chat WIRE/turn implementation from `api/` (no dual paths, no "keep legacy
        routes" hatch). The PG adapter is the single home of the PG/NOTIFY/presence chat logic.
  - [x] No `api/drizzle/*.sql` change.
  - [x] `api/package.json` declares `@sentropic/chat-server` as a workspace dependency; `api/Dockerfile`
        copies the chat-server package manifest before workspace install.
  - [ ] Lot gate:
    - [x] `make typecheck-api` + `make lint-api`
          — PASS (`typecheck-api`; `lint-api` exits 0 with existing console warnings only).
    - [x] API dependency declaration gate:
          `make lock-root ENV=test-feat-chat-server`,
          `make typecheck-api API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-feat-chat-server`,
          `make build-api API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-feat-chat-server`
          — PASS (production audit reports only moderate vulnerabilities, below the target's high threshold).
    - [ ] **API non-regression tests** (`api/tests/**`):
      - [x] The Lot 1 characterization suite (`chat-characterization.spec.ts`) stays GREEN UNCHANGED —
            proves the existing `api/` wire contract did not regress through the extraction.
      - [ ] Add `api/tests/api/chat-server-mount.test.ts` — the chat-server-mounted routes serve over the PG
            adapters in `api/` (a chat round-trip through the api stack: POST → SSE → bootstrap).
        - [x] Initial mount oracle landed: unsupported future `Sec-Sentropic-Wire-Version` is rejected by
              the mounted chat-server route — PASS.
        - [x] Turn-control mount oracle landed: unsupported future `Sec-Sentropic-Wire-Version` is rejected
              on a mounted control route — PASS.
        - [ ] Expand mount test to the full POST → SSE → bootstrap round-trip after stream delegation lands.
      - [x] All existing `api/tests/api/chat-*` specs + any `streams*` specs pass unchanged (non-chat streams untouched).
            Scoped run PASS:
            `make test-api-endpoints SCOPE='tests/api/chat.test.ts tests/api/chat-bootstrap-contract.test.ts tests/api/chat-characterization.spec.ts tests/api/chat-checkpoint-contract.test.ts tests/api/chat-feedback.test.ts tests/api/chat-history-analyze-tool.test.ts tests/api/chat-message-actions.test.ts tests/api/chat-permissions.test.ts tests/api/chat-server-mount.test.ts tests/api/chat-summary-contract.test.ts tests/api/chat-tools.test.ts tests/api/queue-stream-bootstrap-contract.test.ts tests/api/streams.test.ts' API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-feat-chat-server`
            — PASS (13 files, 59 tests).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-chat-server`.

- [ ] **Lot 4 — Full matrix + publish lane (EX1) + UAT**
  - [ ] Wire the publish lane per `BR42a0-EX1` (Makefile targets + ci.yml filters/enum/jobs + the `api`-filter
        `packages/chat-server/**` addition).
    - [x] Makefile validation targets landed: `typecheck-chat-server`, `test-chat-server`,
          `build-chat-server`, `pack-chat-server`; `API_VERSION` includes `packages/chat-server/**`.
    - [x] Makefile publish targets landed: `publish-chat-server` (OIDC) and `publish-chat-server-token`
          (bootstrap).
    - [x] `.github/workflows/ci.yml` landed: `bootstrap_publish_target=chat-server`, `chat_server` and
          `chat_server_publish` filters, `packages/chat-server/**` in the `api` filter, `validate-chat-server`,
          steady-state OIDC `publish-chat-server`, and bootstrap publish step.
    - [x] Publish-lane local verification:
          `make -n publish-chat-server ENV=test-feat-chat-server`,
          `make -n publish-chat-server-token NPM_TOKEN_FILE=/tmp/sentropic-missing-token ENV=test-feat-chat-server`,
          `make typecheck-chat-server ENV=test-feat-chat-server`,
          `make test-chat-server ENV=test-feat-chat-server`,
          `make pack-chat-server ENV=test-feat-chat-server`
          — PASS (3 files, 9 tests; tarball total files 7).
  - [ ] **E2E + full api matrix**:
    - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-feat-chat-server`
    - [ ] Run the chat-relevant e2e groups (cf. `.github/workflows/ci.yml` e2e split) +
          the vscode streaming e2e (chat SSE is the wire under test):
          `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-feat-chat-server E2E_GROUP=<matrix.e2e_group>`.
    - [ ] AI flaky tests run (non-blocking only under acceptance rule): scoped `E2E_SPEC` runs for AI specs; document signatures here.
  - [ ] **UAT (root, `ENV=dev`)**: the monorepo chat still works end-to-end after the extraction — send a
        message, stream a reply, bootstrap a session, stop, steer, retry, tool-results, feedback, checkpoints;
        the 9 non-chat SSE channels (job/org/folder/initiative/lock/presence/workspace/membership/comment) still update.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Sync `spec/SPEC_EVOL_BUILD_APP_CLI.md`: record that `@sentropic/chat-server` is the wire+turn package
        (BR-42a0), the D7 configurable route layer, the generation/queue/stream port set, and the verified
        corrections (the `InMemoryMeshDispatch`-exists correction to §4.1; the app-contract vs canonical
        routes). If a `spec/BRANCH_SPEC_EVOL.md` was used, integrate then delete it.
  - [ ] `BR42a0-Q3`: land the `plan/42-BRANCH_chore-scale-build-app.md` + `PLAN.md` umbrella status update
        (D5 split: BR-42a0 then BR-42a1) on a separate tiny docs commit/branch.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint (chat-server + api) green.
  - [ ] Retest: `make test-chat-server`.
  - [ ] Retest API: `make test-api ENV=test-feat-chat-server` (chat characterization + chat-server mount + non-regression).
  - [ ] Retest E2E: chat-relevant e2e groups + vscode streaming e2e green (cf. ci.yml e2e split).
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document signatures here.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Bumped `packages/chat-server/package.json` (new at `0.1.0`) — `enforce-package-bump` green for the new package.
  - [ ] First-publish bootstrap (`attendu`, post-merge): `workflow_dispatch bootstrap_publish_target=chat-server`
        (token), then attach the OIDC trusted publisher on npmjs.com via Playwright (per
        `Npm-trusted-publisher-via-Playwright`), then steady-state OIDC publish on merge to main.
  - [ ] Final gate step 1: create/update PR using this file's text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
  - [ ] UNBLOCKS BR-42a1: `@sentropic/chat-server@0.1.x` published + api 0-regression-proven (D5 prerequisite satisfied).

## Deferred (recorded, out of BR-42a0)
- **Converging the current app's route SHAPES onto canonical** (`/chat/sessions/:id/{messages,stream,bootstrap}`)
  — D7 keeps the app-contract shape now; convergence is a later optional step.
- **`/tool-permissions` extraction** — app-domain extension permissions stay in `api/`; not chat-server.
- **The other 9 NOTIFY channels** (job/org/folder/initiative/lock/presence/workspace/membership/comment)
  + non-chat `stream_events` — stay app-local in `api/src/routes/api/streams.ts`; never moved into the package.
- **Postgres-durable vs in-memory preset packaging** — chat-server ships both adapter families; preset
  selection by consumers (BR-42a1 uses in-memory).
- **BR-42a1 `feat/build-app-cli`** — the downstream consumer (build-cli + app-template + `@sentropic/cli`
  umbrella); see `plan/42a-BRANCH_feat-build-app-cli.md`.
