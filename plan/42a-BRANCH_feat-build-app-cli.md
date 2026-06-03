# Feature: BR-42a1 Build-App CLI (`@sentropic/cli` umbrella + `@sentropic/build-cli`)

## Dependency (MANDATORY)
- **DEPENDS ON BR-42a0 `feat/chat-server`** (the D5 SPLIT prerequisite — `plan/42a0-BRANCH_feat-chat-server.md`).
  BR-42a1 consumes the PUBLISHED, 0-regression-proven `@sentropic/chat-server@^0.1.x` (with its in-memory /
  synchronous-pump adapter). BR-42a1 does NOT extract or migrate chat-server, and does NOT touch `api/`.
  Do not start BR-42a1 implementation until BR-42a0 is merged + published.

## Objective
Deliver the consumer foundry surface of the BR-42 scale program (BR-42a1): the umbrella CLI `@sentropic/cli`
(binary `stp`, alias `sentropic`) with a subcommand-registration seam, and the `@sentropic/build-cli` package
owning the `stp app` processes (`stp app init <name>`, `stp app doctor`, …) that scaffold a runnable
`chat-ui`↔backend app whose generated backend MOUNTS the published `@sentropic/chat-server` canonical routes
(it does NOT own routes). Bakes in the RATIFIED decisions D1 + D4 of `spec/SPEC_EVOL_BUILD_APP_CLI.md §8`
(D2/D5/D7 — chat-server extraction — are delivered by BR-42a0).

## Scope / Guardrails
- Scope limited to: the two new packages (`packages/cli/**`, `packages/build-cli/**` incl. the embedded
  app-template subtree) and the publish-lane wiring (`Makefile` + `.github/workflows/ci.yml`) under the
  granted `BR42a1-EX1`. `@sentropic/chat-server` is a CONSUMED published dependency (delivered by BR-42a0),
  NOT extracted or modified here.
- No `api/` change and no `api/drizzle/*.sql` migration (the monorepo backend is out of BR-42a1 scope —
  the `api/` migration onto chat-server is BR-42a0).
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-build-app-cli`.
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cli/**` (new: umbrella `@sentropic/cli`, binary `stp` + alias `sentropic`, subcommand seam)
  - `packages/build-cli/**` (new: `@sentropic/build-cli`, the `stp app` subtree + embedded app-template subtree)
  - `package-lock.json` (root lockfile regen for the two new workspace packages)
  - `spec/SPEC_EVOL_BUILD_APP_CLI.md` (sync delivered behaviour; consolidate `BRANCH_SPEC_EVOL` if used)
  - `plan/42a-BRANCH_feat-build-app-cli.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**` (the monorepo UI is not part of the scaffolder MVP)
  - `api/**` (the monorepo backend + its chat-server migration are BR-42a0, not BR-42a1)
  - `packages/chat-server/**` (consumed as a PUBLISHED dependency — delivered by BR-42a0; never edited here)
  - `api/drizzle/*.sql` (no migration)
  - other `plan/NN-BRANCH_*.md` (except this file; `plan/42a0-BRANCH_feat-chat-server.md` is the dependency, read-only)
  - `plan/42-BRANCH_chore-scale-build-app.md` and `PLAN.md` (umbrella status updates land on a docs pass, not here, to avoid `plan/**` cross-branch churn — see BR42a1-Q3)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — requires `BR42a1-EX1` (publish-lane targets for the 2 new packages)
  - `.github/workflows/ci.yml` — requires `BR42a1-EX1` (path filters + bootstrap enum + validate/publish jobs)
- **Exception process**:
  - Declare exception ID `BR42a1-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Actions with the following status should be included around tasks only if really required.
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

- **D1 (BR42a-A + BR42a-B)** `acknowledge` — RATIFIED. Umbrella `@sentropic/cli` (binary `stp`, alias
  `sentropic`) federates subcommands; `@sentropic/build-cli` owns `stp app` (`stp app init`,
  `stp app doctor`). BR-42a1 delivers `@sentropic/build-cli` + the subcommand-registration seam in
  `@sentropic/cli`. Federation of `graphify`/`h2a`/`remote` (separate repos) is OUT of BR-42a1 scope
  (deferred — see `## Deferred`).
- **D2 / D5 / D7 (BR42a-E + plan gate)** `acknowledge` — RATIFIED + SPLIT to **BR-42a0**:
  `@sentropic/chat-server` is extracted and the `api/` migration is done in the PREREQUISITE branch
  `feat/chat-server` (`plan/42a0-BRANCH_feat-chat-server.md`). BR-42a1 only CONSUMES the published
  `@sentropic/chat-server@^0.1.x` (in-memory / synchronous-pump adapter) — it does NOT own/extract routes
  and does NOT touch `api/`.
- **D3 (BR42a-H)** `acknowledge` — RATIFIED: `BR42a1-EX1` GRANTED (see exception below). (BR-42a0 carries
  its own `BR42a0-EX1` for the `chat-server` lane + the `api`-filter addition.)
- **D4 (BR42a-R7)** `acknowledge` — RATIFIED: the generated app depends on the published
  `@sentropic/design-system-svelte` + `-themes` + `-tokens` (not an inline theme).
- **BR42a1-EX1** `acknowledge` (Makefile + `.github/workflows/ci.yml`) — GRANTED (D3). For EACH of
  `cli`, `build-cli`: add `typecheck-<pkg>`, `test-<pkg>`, `build-<pkg>`, `pack-<pkg>`,
  `publish-<pkg>` (OIDC), `publish-<pkg>-token` (bootstrap), mirroring the `chat-ui`/`cowork-bridge`
  targets line-for-line; in `ci.yml` add `<pkg>`/`<pkg>_publish` path filters (mirroring the per-package
  shapes at lines ~140–203), two entries in the `bootstrap_publish_target` enum (currently
  `none|contracts|events|chat-core|chat-ui|auth-hono|auth-ui|flow|cowork-bridge|cowork-desktop|all` — note
  `chat-server` is added by BR-42a0), one `validate-<pkg>` job each, one steady-state OIDC `publish-<pkg>`
  job each (fires on `github.ref == main`), and two bootstrap steps in the dispatch job. Reason: a
  publishable package cannot ship without its lane. Impact: additive targets/filters/enum/jobs only; no
  change to other packages' lanes. Rollback: remove the added targets/filters/enum entries/jobs and the
  package dirs. First publish per package needs the documented bootstrap-then-attach flow (token
  `workflow_dispatch` then attach OIDC trusted publisher on npmjs.com) — recorded as `attendu` post-merge.
  - **BR42a1-EX1 USED (implemented)** `acknowledge` — Makefile: added `publish-build-cli`/
    `publish-build-cli-token` + `publish-cli`/`publish-cli-token` (OIDC + bootstrap), mirroring
    `publish-chat-server`/`-token` line-for-line (`typecheck`/`test`/`build`/`pack` already present).
    ci.yml: added `build_cli`/`build_cli_publish`/`cli`/`cli_publish` `changes` outputs + path filters
    (mirroring the chat-server filter shape; the `cli` validate filter ALSO watches
    `packages/build-cli/**` because `@sentropic/cli` depends on `@sentropic/build-cli` — the
    cowork-desktop→cowork-bridge dependent-package precedent), `validate-build-cli` + `validate-cli`
    jobs (typecheck+test+build+pack, mirroring `validate-chat-server`), steady-state OIDC
    `publish-build-cli` + `publish-cli` jobs (`github.ref == main`, gated on `<pkg>_publish`), two
    enum entries (`build-cli`,`cli`) + two bootstrap dispatch steps. yaml parse OK; `make typecheck-cli`/
    `typecheck-build-cli` green. No `lint-<pkg>` target added: NO sibling pure-Node package
    (`chat-server`/`cowork-bridge`/`llm-mesh`/`flow`/…) has a lint target and their `validate-*` jobs do
    not lint — the gate for pure-Node packages is `tsc` typecheck + vitest; a bespoke lint target would be
    unvalidated entropy (per `feedback_reuse_ui_no_entropy` / `feedback_no_unvalidated_naming`).
  - **BR42a1-EX1 first-publish** `attendu` (post-merge, per package) — `enforce-package-bump` skips both
    (new packages, no base version); first publish is the bootstrap-then-attach flow: `workflow_dispatch
    bootstrap_publish_target=build-cli` then `=cli` (token, on main), then attach the OIDC trusted publisher
    on npmjs.com (drive via Playwright per `Npm-trusted-publisher-via-Playwright`), then steady-state OIDC
    `publish-build-cli`/`publish-cli` on subsequent merges. NOT attempted in this branch.
- **BR42a1-Q1** `attention` (umbrella dispatch mechanism). D1 leans `plugin discovery` (each
  `@sentropic/*-cli` self-registers, tied to the `CatalogSource` idea). For BR-42a1 only `build-cli` is
  a real plugin. Question: ship the discovery seam as (1) a static registration table in
  `@sentropic/cli` that `build-cli` is added to, or (2) a package-name-convention resolver
  (`@sentropic/*-cli` discovered from installed deps), or (3) an explicit `register(subcommand)` API
  `build-cli` calls. Préco: (3) a typed `registerSubcommand()` contract co-designed with `build-cli` as
  the first real consumer (contract-consumer co-design), with a convention-resolver as a thin layer on
  top later. Resolve at Lot 0.
- **BR42a1-Q2** `attention` (chat-server consumption pinning). The generated app's `package.json` pins
  `@sentropic/chat-server ^0.1.x` and mounts its CANONICAL routes via `createChatServer(InMemory.*, { routes:
  'canonical' })` + the in-memory/synchronous-pump GenerationPort/QueuePort. During BR-42a1 development,
  before BR-42a0 is published, the template subtree typecheck/smoke may consume chat-server via the
  workspace symlink (standalone-symlink pattern like cowork-desktop). Confirm at Lot 0 that BR-42a0 is
  merged+published (so the golden fixtures pin a real published version, not a workspace path).
- **BR42a1-Q3** `attention` (plan/PLAN umbrella sync). `plan/42-BRANCH_chore-scale-build-app.md` + `PLAN.md`
  must record the D5 split (BR-42a0 ships `@sentropic/chat-server`; BR-42a1 ships `@sentropic/cli` +
  `@sentropic/build-cli`). Préco: do this on a tiny separate docs commit/branch to keep `plan/**`
  cross-branch churn out of this feature branch (Forbidden Paths above). Confirm owner. (Coordinate with
  BR42a0-Q3 — likely one combined docs pass.)
- **BR42a1-B1** `acknowledge` (RESOLVED — packaging bug found by the real-binary smoke) — both
  `@sentropic/cli` and `@sentropic/build-cli` `package.json` had `main`/`types`/`exports.import`
  pointing at `./src/index.ts` (and the build-cli subpath exports `./templating`/`./generator`/
  `./manifest` at `src/*.ts`). Node cannot import `.ts` at runtime, so `bin/stp.mjs`'s
  `import … from '@sentropic/build-cli'` (and any published consumer) would fail with
  `ERR_MODULE_NOT_FOUND` — diverging from every published sibling (`chat-server` points at
  `./dist/index.js`). Fix: repoint `main`/`types`/`exports` to `./dist/**` mirroring chat-server,
  line-for-line (`files` still ships `src` per the documented tarball contents; only resolution
  changed). Guarded by `packages/build-cli/tests/binary-smoke.spec.ts`. All gates re-green after fix.
- **BR42a-F** `acknowledge` — `--h2a-register` emits a minimal LOCAL descriptor only (SPEC §5.2-F
  Option 1), explicitly non-protocol; real h2a register deferred upstream (EVO-9).
- **BR42a-G** `acknowledge` — GitHub policy per SPEC §5.2-G: explicit `--github-owner`, private default,
  refuse on name collision, never mutate an existing remote, backfill repo URL before first commit.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in this file; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- The hermetic `stp app init → make dev` smoke (Lot 3) routes through the deterministic `stub`
  `ProviderAdapter` (offline) — it must NOT be flaky; any nondeterminism there is a generator bug
  (R10 invariant), never an allowlisted flake.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single feature branch `feat/build-app-cli`, internal lots a0/a1/a2; one final test cycle)
- [ ] **Multi-branch**
- Rationale: the three deliverables are sequentially coupled (a1's hermetic template smoke depends on
  a0's `@sentropic/chat-server`; a2's umbrella seam is a thin registration contract over a1). A single
  branch with internal lots gives one CI cycle and avoids version-sync churn between three packages that
  land together under one EX1. Sub-agents may take orthogonal lots in slots 0..4, integrated on this branch.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after the relevant lots (the generated-app
  smoke + the `api/` non-regression).
- UAT checkpoints listed as checkboxes inside the relevant lots (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-build-app-cli`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`) for the `api/`
    non-regression (chat still works); the generated-app UAT runs in a throwaway temp dir, never on root.
  - Switch back to `tmp/feat-build-app-cli` after UAT.

## Wave & Port Allocation (branch nn = 42)
- Slot ports: API `9000 + (42*5) + slot` = `9210..9214`; UI `5200 + (42*5) + slot` = `5410..5414`;
  Maildev UI `1100 + (42*5) + slot` = `1310..1314`.
- Slot 0 (default lot owner): `API_PORT=9210`, `UI_PORT=5410`, `MAILDEV_UI_PORT=1310`, `ENV=feat-build-app-cli`.
- The hermetic generated-app smoke (Lot 3) uses pinned NON-reserved ports drawn from this branch slot
  range (e.g. API `9211`, UI `5411`) for the scaffolded app's own compose project — NEVER the monorepo
  reserved `8787/5173/1080`. The generated-app compose project name = the app slug (BR42a-Q9 of SPEC).
- Before launching any sub-agent: `make ps-all` to verify no port conflict.
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline, scoping & EX1 declaration**
  - [x] Verify branch: `git -C tmp/feat-build-app-cli branch --show-current` = `feat/build-app-cli`.
  - [x] Create/confirm isolated worktree `tmp/feat-build-app-cli` from `main`; copy `.env`, override
        `ENV=feat-build-app-cli` + slot-0 ports (9210/5410/1310).
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`,
        `rules/security.md`, `PLAN.md`, `spec/SPEC_EVOL_BUILD_APP_CLI.md` (esp. §8 RATIFIED), §6 tests,
        §7 sequencing, `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §16`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Validate scope boundaries; record `BR42a-EX1` (Makefile + ci.yml) in `## Feedback Loop`.
  - [x] Resolve `BR42a-Q1` (dispatch mechanism — option 3 typed `SubcommandRegistry.register()`),
        `BR42a-Q2` (single-branch a0/a1/a2 confirmation), `BR42a-Q3` (plan/PLAN sync owner —
        separate docs pass), `BR42a-E1` (api adopts chat-ui-shaped routes vs additive mount).
  - [x] Create the package skeletons (`packages/cli`, `packages/build-cli`)
        each with `package.json` (`license: "MIT"`, `version: "0.1.0"`, `@sentropic/<name>`), `tsconfig.json`,
        `LICENSE` (MIT), `README.md`. Mark NONE `private`. (`packages/chat-server` is BR-42a0's, consumed published.)
  - [x] Confirm chat-core in-memory adapter availability (VERIFIED: `@sentropic/chat-core` exports
        `InMemory.{InMemoryMessageStore, InMemorySessionStore, InMemoryStreamBuffer,
        InMemoryCheckpointStore, InMemoryMeshDispatch, InMemoryStreamSequencer}` + `ChatRuntime`; the
        SPEC §4.1 claim that `InMemoryMeshDispatch` does not exist is WRONG — record the correction).
  - [x] Regenerate the root lockfile for the new workspace packages `cli`/`build-cli` (`make lock-root`).

- [ ] **Lot a0 — Extract `@sentropic/chat-server` (the SSE wire server)**
  - [ ] In `packages/chat-server/src/**`, define the port-driven wire surface matching the chat-ui
        default transport: `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream` (SSE,
        `fromSeq` honoured), `GET /chat/sessions/:id/bootstrap`. Build it over `@sentropic/chat-core`
        `ChatRuntime` + the chat-core port interfaces — NO Drizzle/PG/presence imports in the package.
  - [ ] Export a mountable Hono router factory `createChatServer(deps)` where `deps` are the chat-core
        ports (`MessageStore`/`SessionStore`/`StreamBuffer`/`CheckpointStore`/`StreamSequencer`/
        `MeshDispatch`) + the llm-mesh dispatch — so the generated app injects `InMemory.*` and `api/`
        injects its Drizzle/PG-backed adapters (BR42a-E1).
  - [ ] Migrate `api/` to consume the package WITHOUT regressing the existing wire contract: per
        BR42a-E1 decision, either (additive, préco) mount `createChatServer(drizzleAdapters)` alongside
        the existing `chat.ts`/`streams.ts` routes, or re-point the existing handlers. Touch only the
        Allowed `api/` files; build the Drizzle/PG adapters that satisfy the chat-core ports from
        `services/chat-service.ts` + `services/stream-service.ts` (seam only, no behavioural change).
  - [ ] Keep the non-chat `streams.ts` multiplexing (org/folder/initiative/lock/presence/workspace/
        comment) entirely app-local (BR42a-E2). No `api/drizzle/*.sql` change.
  - [ ] Lot gate:
    - [ ] `make typecheck-chat-server` + `make typecheck-api` + `make lint-api`
    - [ ] **chat-server unit tests** (`packages/chat-server/tests/**`):
      - [ ] Add `tests/wire-contract.spec.ts` — assert the router serves exactly the three chat-ui
            transport routes and rejects the unimplemented `/sessions/:id/events?fromSeq=N` replay
            endpoint + the `Sec-Sentropic-Wire-Version` header (study-spec futures, not shipped).
      - [ ] Add `tests/in-memory-roundtrip.spec.ts` — `POST messages` → SSE `stream` streams an
            assistant reply via `InMemoryMeshDispatch` + a deterministic stub adapter; `bootstrap` returns
            seeded messages. Determinism asserted (no timestamps/random in payload shape).
      - [ ] Add `tests/ports-contract.spec.ts` — `createChatServer` rejects missing/invalid port deps.
      - [ ] Scoped runs: `make test-chat-server` (Vitest, node env, standalone symlink pattern like cowork-bridge).
    - [ ] **API non-regression tests** (`api/tests/**`):
      - [ ] Add `api/tests/api/chat-server-mount.test.ts` — the package-mounted routes serve over the
            Drizzle adapters in `api/` (a chat round-trip through the api stack).
      - [ ] Update/verify `api/tests/api/chat-*.spec.ts` (existing chat endpoint tests) still pass
            unchanged — proves the existing `api/` wire contract did not regress.
      - [ ] Verify `api/tests/api/streams*.spec.ts` (if present) still pass — non-chat streams untouched.
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-build-app-cli`.
    - [ ] `make build-chat-server` + `make pack-chat-server` (tarball excludes tests/fixtures).
    - [ ] Bump `packages/chat-server/package.json` to `0.1.0`; bump `api/` only if its `src/**` public
          surface changed (it is an app root, not a published package — no bump needed).

- [x] **Lot a1 — `@sentropic/build-cli` (`stp app`): templating substrate + generator + `init`/`doctor` + app template**
  - [x] Templating substrate (`packages/build-cli/src/templating/**`): deterministic `{{token}}`
        substitution over a file tree + a scaffold manifest (template files → output paths + transforms),
        dependency-light, behind an interface designed for later `@sentropic/harness` adoption (R5).
  - [x] Generator core (`packages/build-cli/src/generator/**`): resolve scaffold plan from a manifest
        + options; deterministic output (R10 invariant — no timestamps/random/env-ordering). Pure planner
        (`resolvePlan`) + thin no-partial-write filesystem writer (`writePlan`).
  - [x] `stp app` verbs (`packages/build-cli/src/commands/**`): `init <name>` (flags `--dir`,
        `--provider stub|openai|gemini|anthropic|mistral|cohere`, `--git/--no-git`,
        `--github/--no-github`, `--github-visibility`, `--github-owner`, `--h2a-register`, `--yes/-y`,
        `--force`, `--dry-run`), `doctor` (Docker/make/gh-auth/engines/port-availability incl. generated-app
        port-conflict detection), `--version`, `--help`. Exposed via `runAppCli(argv)` (importable, returns
        an exit code); the umbrella surfaces it as `stp app <verb>` (D1) in lot a2.
  - [x] `--force` semantics: without `--force` → refuse-with-list (`TargetNotEmptyError`, non-zero); with
        `--force` → overwrite-scaffold-owned-files-only (writer `overwrite`, never blanket-delete).
  - [x] GitHub path (`--github`): shell out to `gh repo create <owner>/<name> --<visibility> --source
        <dir> --push`; BR42a-G gating (explicit owner, private default, refuse on collision, never mutate
        existing remote, backfill repo URL before first commit). `--dry-run` prints the exact `gh`
        invocation without running it.
  - [x] `--h2a-register`: emit the minimal local non-protocol descriptor only (BR42a-F); no network call.
  - [x] App-template subtree (`packages/build-cli/templates/chat-app/**`, self-contained `package.json`
        for lift-and-shift to a future `@sentropic/app-template`):
    - [x] Backend (`api/` inside the generated app): mounts `@sentropic/chat-server`'s
          `createChatServer(createInMemoryChatServerDeps({ assistantReply }), { routes: 'canonical' })`
          (offline in-memory adapter; deterministic reply, no provider key) + `@hono/node-server`. (CONSUMES
          `@sentropic/chat-server`; it does NOT own the routes — supersedes the §4.1 template-owned premise.) No Postgres.
    - [x] Web UI (`ui/` inside the generated app): Svelte 5 app embedding `@sentropic/chat-ui`
          `ChatPanel` via `createDefaultTransport(baseUrl)` + `createWebHost`/`createStreamHub` (imported from
          `@sentropic/chat-ui/components/*` + `/client/*` + `/hosts/*`), `VITE_API_BASE_URL` aligned to the backend port.
    - [x] Design surface: depend on published `@sentropic/design-system-svelte` + `-themes` + `-tokens` (D4).
    - [x] Tooling: `Makefile`/make-include (`dev`/`down`/`typecheck`/`build`, Docker-first),
          `docker-compose.yml` (isolated project name = app slug, non-reserved ports), `.env.example`
          (provider-key slots + ports), `package.json` pinned to published `@sentropic/*`
          (chat-ui ^0.1.x, chat-core ^0.1.x, llm-mesh ^0.1.x, chat-server ^0.1.x, design-system-svelte
          ^0.10.x + themes/tokens) + peers (svelte ^5, `@lucide/svelte` ^0.562, `svelte-streamdown` ^3,
          hono), `README.md`, `LICENSE` (MIT), `.gitignore` (MUST exclude `.env`).
  - [x] Lot gate:
    - [x] `make typecheck-build-cli` (PASS). (`make lint` deferred to final lot; template subtree is a string
          corpus — not part of build-cli's tsc, validated via golden + init materialise specs + pinned-version asserts.)
    - [x] **Generator unit tests (golden-file)** (`packages/build-cli/tests/**`):
      - [x] `tests/generator-golden.spec.ts` — real chat-app manifest through `resolvePlan` with fixed
            tokens, byte-for-byte vs committed golden fixture (`fixtures/chat-app-golden.json`; R10). Covers token
            substitution (name/ports/provider/repo-URL), pinned `@sentropic/*` versions, that the generated
            backend mounts `@sentropic/chat-server` canonical (NOT template-owned routes), and declares
            NO `/sessions/:id/events` replay route / `Sec-Sentropic-Wire-Version` header. (`tests/manifest.spec.ts`
            covers loader determinism + `_gitignore`->`.gitignore`; `init.spec.ts` materialises the real template.)
      - [x] `tests/templating.spec.ts` — substitution correctness, missing-token failure, idempotent
            re-render, determinism (R10). (no-partial-write covered by `tests/writer.spec.ts`;
            deterministic plan resolution covered by `tests/generator.spec.ts` golden fixture.)
      - [x] `tests/doctor.spec.ts` — each pre-flight check (Docker/make/gh-auth/engines/port-availability
            incl. generated-app port-conflict) with mocked env; correct non-zero exit on failure.
      - [x] `tests/repo-create-safety.spec.ts` — stub `gh`+`git`, force temp `HOME`+`PATH`; run
            `init demo --github --dry-run` AND the real `--github` path against the stubs; assert ZERO
            side effects, the exact `gh repo create ...` command string, collision refusal, existing-remote refusal.
      - [x] `tests/h2a-register.spec.ts` — `--h2a-register` emits the local descriptor only; no network call.
      - [x] `tests/negative.spec.ts` — invalid/empty/whitespace/non-slug/reserved names, path traversal
            (`../`, absolute) in `--name`/`--dir`, existing non-empty dir (refuse vs `--force`), existing
            git repo/remote (refuse), flag errors, `.env` gitignored / never in scaffold. (missing
            Docker/make/gh + port-conflict covered by `tests/doctor.spec.ts`; `init.spec.ts` covers the
            dry-run/materialise + provider-validation + `.gitignore` excludes `.env`.)
      - [x] Scoped runs: `make test-build-cli` (114 tests PASS).
    - [x] `make build-build-cli` + `make pack-build-cli` (tarball includes `templates/**` incl. `_gitignore`,
          excludes tests/fixtures — 106 files, 52 kB).
    - [x] Bumped `packages/build-cli/package.json` to `0.2.0` (public surface grew: `./manifest` export +
          default chat-app scaffolding; `BUILD_CLI_VERSION` synced).
    - [x] **Real-binary smoke (no docker)** — the assembled `stp` binary, run end to end:
      - [x] `packages/build-cli/tests/binary-smoke.spec.ts` spawns the published-shaped binary
            (`node packages/cli/bin/stp.mjs`), resolving `@sentropic/build-cli` through its
            `package.json` `exports` map (which now points at `dist/**`, NOT `src/*.ts` — see the
            exports fix in `## Feedback Loop` / commit `fix(BR-42a1): point cli/build-cli package
            exports at dist`). Asserts: `--version` (semver), `--help` lists `app`, `app --help`
            delegates to `runAppCli`, `--dry-run` writes nothing, and `app init demo --yes --provider
            stub --no-git --no-github` materialises a tree whose backend mounts
            `createChatServer(createInMemoryChatServerDeps(...), { routes: 'canonical' })`, `.gitignore`
            excludes `.env`, `package.json` pins `@sentropic/chat-server`/`chat-ui`/`design-system-svelte`,
            and there is NO leftover `{{token}}` / `/sessions/:id/events` / `Sec-Sentropic-Wire-Version`.
      - [x] Build-resilient: the spec self-skips when `dist/` is absent (CI `validate-*` jobs run tests
            before build); it runs the real binary locally after `make build-build-cli && make build-cli`.
            Verified: `make test-build-cli` → `tests/binary-smoke.spec.ts (5 tests)` PASS (119 total).
      - [ ] **Docker `make dev` round-trip** `attendu` (UAT, NOT runnable in this lane): the generated
            app's `make dev` (Docker Compose, app-slug project, ports API `9211`/UI `5411`/Maildev `1311`)
            served UI + a streamed `stub` reply over `GET /chat/sessions/:id/stream`. Deferred to the UAT
            checklist below — this lane forbids raw `docker run` and the smoke target/Makefile is frozen.

- [x] **Lot a2 — `@sentropic/cli` umbrella (`stp`) + `stp app` registration seam**
  - [x] `packages/cli/src/**`: binary `stp` (alias `sentropic`) with the subcommand-registration seam
        decided in BR42a-Q1 (préco option 3: typed `SubcommandRegistry.register()` contract in
        `src/registry.ts`; plugin-agnostic dispatcher in `src/cli.ts`); the `stp` bin (`bin/stp.mjs`,
        composition root) imports `@sentropic/build-cli` and registers `stp app` — core never imports
        build-cli, so no cycle. `--version` (CLI + registered subcommand versions), `--help` (lists
        subcommands), per-subcommand help (`stp app --help` delegates to `runAppCli`).
  - [x] Document (in `packages/cli/README.md`) that `stp graphify`/`stp h2a`/`stp remote` are reserved
        federation points OUT of BR-42a scope (separate repos).
  - [x] Lot gate:
    - [x] `make typecheck-cli` (PASS). (`make lint` deferred to final lot per plan convention.)
    - [x] **cli unit tests** (`packages/cli/tests/**`):
      - [x] `tests/registry.spec.ts` — `SubcommandRegistry.register()` registers `app`, duplicate-name
            guard (`DuplicateSubcommandError`), malformed-entry guard (`InvalidSubcommandError`), lookup
            (`get`/`has`/`list` sorted).
      - [x] `tests/dispatch.spec.ts` — `stp --version`/`-v` aggregates CLI + subcommand versions;
            `stp --help`/`-h`/bare lists `app`; unknown subcommand → non-zero + lists available; `app …`
            delegates to a stubbed `runAppCli` with the remaining argv and propagates its exit code
            (covers the `registration.spec`/`version-help.spec` assertions).
      - [x] Scoped runs: `make test-cli` (8 tests PASS).
    - [x] `make build-cli` + `make pack-cli` (tarball: `bin/stp.mjs` + `dist/**` + `src/**`, excludes
          tests — 19 files, 7.9 kB; bins `stp` + `sentropic` both point at `bin/stp.mjs`).
    - [x] `packages/cli/package.json` at `0.1.0` (new package); added `@sentropic/build-cli` dep +
          regenerated root lockfile (`make lock-root`).

- [ ] **Lot N-2 — UAT**
  - [ ] **Copy-pasteable UAT (run from the worktree; throwaway temp dir; NEVER root `ENV=dev`)**.
        Pre-publish, wire the assembled binary the way `npm i -g` would (cli's ESM bin resolves
        `@sentropic/build-cli` from `packages/cli/node_modules`), then run the round-trip:
        ```sh
        # 0. Build both dist (binary needs dist/**, not src/*.ts — see BR42a1-B1)
        make build-build-cli
        make build-cli
        # 1. Make the local build-cli resolvable to the stp bin (post-publish this is `npm i`)
        mkdir -p packages/cli/node_modules/@sentropic
        ln -sfn "$PWD/packages/build-cli" packages/cli/node_modules/@sentropic/build-cli
        # 2. Drive the assembled binary in a throwaway dir (deterministic offline stub)
        SMOKE="$(mktemp -d)"
        node packages/cli/bin/stp.mjs --version
        node packages/cli/bin/stp.mjs --help            # lists `app`
        node packages/cli/bin/stp.mjs app --help
        node packages/cli/bin/stp.mjs app init demo --yes --provider stub --no-git --no-github --dir "$SMOKE/demo"
        # 3. Docker `make dev` round-trip (the `attendu` gate): UI served + stub reply streamed
        ( cd "$SMOKE/demo" && make dev )                # open the UI; send a message → stub reply over /chat/sessions/:id/stream
        ( cd "$SMOKE/demo" && make down )               # teardown; no leaked containers/volumes/ports
        # 4. cleanup
        rm -rf "$SMOKE" packages/cli/node_modules
        ```
        Expected: exit 0 throughout; `.gitignore` excludes `.env`; `api/src/server.ts` mounts
        `createChatServer(createInMemoryChatServerDeps(...), { routes: 'canonical' })`; the UI loads and a
        sent message streams a `stub` assistant reply; `make down` leaves no residue. (The automated
        `packages/build-cli/tests/binary-smoke.spec.ts` already asserts steps 1–2 + the generated-tree
        invariants offline; step 3 is the human docker round-trip.)
  - [ ] Generated app (throwaway temp dir, NEVER root): `stp app init demo --provider stub`
        (interactive) → wizard clear, defaults sane, `.gitignore` excludes `.env`; `cd demo && make dev`
        → UI loads, chat message streams a stub reply over `/chat/sessions/:id/stream`, no runtime errors.
  - [ ] `stp app init demo3 --dry-run --github --github-owner <owner>` → prints plan + exact
        `gh repo create` command, writes nothing, creates no repo.
  - [ ] `stp app init demo2 --github --github-owner <owner> --github-visibility private` (gh authed) →
        repo created under explicit owner, first commit pushed, repo URL backfilled, `.env` NOT in pushed tree.
  - [ ] `stp app init demo --force` over a non-empty dir behaves per defined semantics; without `--force` refuses with list.
  - [ ] Generated-app ports do NOT collide with `8787/5173/1080`; compose project name = app slug.
  - [ ] `--h2a-register` writes the local non-protocol descriptor only; no h2a session.
  - [ ] **`api/` non-regression UAT (root, `ENV=dev`)** — `attendu`/owned by BR-42a0, not BR-42a1: the
        `@sentropic/chat-server` extraction + `api/` migration are BR-42a0's scope (proven there;
        `api/` and `packages/chat-server/**` are Forbidden here). BR-42a1 only CONSUMES the published
        `@sentropic/chat-server` in the generated app. Re-confirm at merge that the monorepo chat still
        works end-to-end (send a message, stream a reply, bootstrap a session) — no BR-42a1 change touches it.
  - [ ] Naming sign-off: binary `stp` (+ alias `sentropic`), packages `@sentropic/cli` /
        `@sentropic/build-cli` / `@sentropic/chat-server` (gate before merge — D1 ratified, confirm at UAT).
  - [ ] Licensing sign-off: generated-app `LICENSE` = MIT, `package.json license: "MIT"` (SPEC BR42a-I).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Sync `spec/SPEC_EVOL_BUILD_APP_CLI.md` to delivered behaviour (3-package shape; chat-server
        extraction; the verified wire-contract corrections in BR42a-E1; the `InMemoryMeshDispatch`-exists
        correction to §4.1; the BR42a1-B1 exports-at-`dist` packaging fix; build-cli `0.2.0`; the offline
        `assistantReply` path). NOTE `attendu`: `spec/SPEC_EVOL_BUILD_APP_CLI.md` is NOT committed on this
        branch (it lives untracked on the root checkout's other branch); it must be committed here / synced
        on the docs pass before this item can close. Cannot be edited from this worktree without touching
        the root checkout. If a `spec/BRANCH_SPEC_EVOL.md` was used, integrate then delete it.
  - [ ] `BR42a-Q3`: land the `plan/42-BRANCH_chore-scale-build-app.md` + `PLAN.md` umbrella status update
        on a separate tiny docs commit/branch (keep `plan/**` cross-branch churn off this branch).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint (cli + build-cli + chat-server + api) green.
  - [x] Retest BR-42a1 packages: `make test-build-cli` (119 PASS incl. binary-smoke), `make test-cli`
        (8 PASS). (`make test-chat-server` is BR-42a0's gate — chat-server is Forbidden here.)
  - [ ] Retest API: `make test-api ENV=test-feat-build-app-cli` (chat non-regression) — `attendu`, BR-42a0
        scope (`api/` is Forbidden here).
  - [x] Real-flow E2E: delivered as the offline real-binary smoke `packages/build-cli/tests/binary-smoke.spec.ts`
        (no docker; runs the assembled `stp` bin). The Docker `make dev` round-trip is `attendu`/UAT (Lot N-2
        command block). No `e2e/tests/42-*.spec.ts` / make smoke target added — `Makefile`/`ci.yml`/`e2e/**`
        are frozen/out of scope for the finalize pass.
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document signatures in this file.
        N/A: the only generated-app reply path is the deterministic offline `stub` — no AI nondeterminism.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted. N/A (no AI flaky test).
  - [x] `packages/build-cli` at `0.2.0`, `packages/cli` at `0.1.0` (both new on this branch);
        `enforce-package-bump` skips new packages (no base version). The BR42a1-B1 exports fix touched
        only `package.json` (not `src/**`), so the gate is not triggered; it ships with the first publish.
  - [ ] First-publish bootstrap (`attendu`, post-merge per package): `workflow_dispatch
        bootstrap_publish_target=<pkg>` (token), then attach the OIDC trusted publisher on npmjs.com,
        then steady-state OIDC publish on merge to main. Drive the npmjs.com trusted-publisher attach via
        Playwright right after the first publish (per `Npm-trusted-publisher-via-Playwright`).
  - [ ] Final gate step 1: create/update PR using this file's text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.

## Deferred (recorded, out of BR-42a)
- **Umbrella federation of `graphify` / `h2a` / `remote`** (each in its own repo) under `@sentropic/cli`
  (`stp graphify …`, `stp h2a …`, `stp remote …`) — the seam ships here, the federated subcommands do not.
- **`@sentropic/app-template` promotion** — the embedded `templates/chat-app/**` subtree is structured
  for a later lift-and-shift to a separately published package (SPEC §3.3 Option a).
- **UI-driven evolution loop** (manage spec/evolutions in-app, background branch agents, attention via h2a).
- **DOCX / business doc-gen extraction** (`@sentropic/doc-gen`) — SPEC R6.
- **Real h2a register** (vs the MVP local descriptor) — BR42a-F, co-designed upstream when EVO-9 freezes.
- **`--with-auth` template preset** (wire `@sentropic/auth-ui` + `@sentropic/auth-hono`) once BR-39 merges.
- **Sibling `add <capability>` capabilities** (BR-42b catalog+agents+canvas, BR-42c comments,
  BR-42d persistence/observability, BR-42e flow queue streaming, BR-42f Vertex AI, BR-42g BigQuery sink).
- **Postgres-durable generated-app preset** (MVP ships in-memory adapters only — SPEC R8).
- **Deploy / GitOps / `k8s-ops`→PaaS** + the `sentropic`↔`k8s-ops` contract — SPEC §1.2 / boundaries §16.5.
- **Central sentropic instance / multi-tenant managed h2a MCP / BYO-h2a**; **iii integration-parity**; **app relocation**.
