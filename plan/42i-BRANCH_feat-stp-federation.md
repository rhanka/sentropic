# Feature: `stp` Federation Roster + Verb-Vocabulary Harmonization (BR-42i)

## Objective
Extend `@sentropic/cli` with a `VerbRegistry` + optional `deps.verbRegistry` field on `CliDeps`, a static federation manifest (`federation.ts`) with a discovery loader (absent=skip, installed-broken=fail-loudly), and wire the bin to register `report`→`track report` as the sole initial bare-verb alias. 0-regression on all existing `stp app` / `--help` / `--version` / unknown-subcommand paths.

## Scope / Guardrails
- Scope limited to `packages/cli/**` and `packages/cli/package.json` (minor version bump).
- No service stack — CLI-only lot; no Docker compose needed.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-stp-federation-42i`.
- Automated test campaigns run on dedicated environment (`ENV=test-feat-stp-federation-42i`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cli/src/**`
  - `packages/cli/bin/stp.mjs`
  - `packages/cli/package.json`
  - `packages/cli/tests/**`
  - `spec/SPEC_EVOL_STP_FEDERATION.md`
  - `plan/42i-BRANCH_feat-stp-federation.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/harness/**`
  - `plan/NN-BRANCH_*.md` (other branch files)
  - Any cross-repo CLI source (`rhanka/h2a`, `rhanka/track`, etc.)
  - BR-42k scope (lazy-skill loading, à-la-carte manifest, conflict-avoidance mode)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` — only if `packages/cli` needs a new publish-lane step; unlikely since the package already has its lane
- **Exception process**:
  - Declare exception ID `BR42i-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **Lot0-D1 (DISCOVERY, closed)**: Plan stated `make test SCOPE=packages/cli/tests` and `make typecheck` — these are the global multi-service targets. Real targets are `make test-cli` and `make typecheck-cli` (CLI-specific Docker-run lanes). No `lint-cli` target exists; `packages/cli/package.json` has no lint script. Applicable quality gates for CLI-only work: `typecheck-cli` + `test-cli`. No prod code impact; all 16 tests pass.

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
- Rationale: All changes are in a single package (`packages/cli`), sequentially dependent (Lot 0 pins oracle → Lot 1 adds VerbRegistry → Lot 2 adds federation → Lot 3 wires bin → Lot N final). No orthogonal workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after Lot 3 bin wiring, when bin changes exist).
- UAT checkpoints listed as checkboxes inside Lot 3.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-stp-federation-42i`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/feat-stp-federation-42i` after UAT.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Characterization (0-regression oracle)**
  - [x] Confirm worktree is `feat/stp-federation-42i`: `git -C /home/antoinefa/src/sentropic/tmp/feat-stp-federation-42i branch --show-current`
  - [x] Read `packages/cli/src/registry.ts`, `cli.ts`, `index.ts`, `bin/stp.mjs`, `packages/cli/package.json`
  - [x] Read existing tests: `packages/cli/tests/dispatch.spec.ts`, `packages/cli/tests/registry.spec.ts`
  - [x] Record current `packages/cli` version (`0.1.0`) and confirm it is the pre-bump baseline
  - [x] Run existing CLI tests GREEN as the 0-regression oracle: `make test-cli ENV=test-feat-stp-federation-42i` (real target: `test-cli`, not `make test SCOPE=...`)
  - [x] Capture and record stdout of `stp --help`, `stp --version`, `stp bogus` (exact bytes) as regression fixtures
  - [x] Confirm scope boundaries (`Allowed/Forbidden/Conditional`) match this BRANCH.md
  - [x] Lot gate:
    - [x] `make typecheck-cli ENV=test-feat-stp-federation-42i` PASS (real target: `typecheck-cli`; no `lint-cli` exists — CLI package has no lint tooling)
    - [x] `make lint ENV=test-feat-stp-federation-42i` — N/A for CLI-only: no `lint-cli` target; `typecheck-cli` is the applicable quality gate (DISCOVERY: see Feedback Loop)
    - [x] CLI tests pass: `make test-cli ENV=test-feat-stp-federation-42i` — 16 passed (8 existing + 8 new characterization)

- [x] **Lot 1 — `VerbRegistry` + `runCli` extension (0-regression GATE)**
  - [x] Add `packages/cli/src/verb-registry.ts`:
    - [x] `VerbBinding` interface (`verb`, `ownerCli`, `ownerArgv`, optional `note`)
    - [x] `DuplicateVerbError extends Error` (parallel to `DuplicateSubcommandError`)
    - [x] `VerbRegistry` class: `.register(binding): this`, `.get(verb): VerbBinding | undefined`, `.list(): readonly VerbBinding[]` (sorted)
  - [x] Extend `packages/cli/src/cli.ts`:
    - [x] Add `verbRegistry?: VerbRegistry` as OPTIONAL field on `CliDeps` interface (NOT a new positional param — `runCli(argv, registry, deps)` signature UNCHANGED)
    - [x] After subcommand lookup fails AND before `formatUnknown`, check `deps.verbRegistry?.get(first)`: if match found, look up `ownerCli` in `registry`, call `subcommand.run([...ownerArgv, ...rest])`, return its exit code; if `ownerCli` not registered in `registry`, fall through to `formatUnknown` (not a crash)
    - [x] No change to `formatHelp`, `formatVersion`, `formatUnknown` — additive only
  - [x] Export `VerbRegistry`, `VerbBinding`, `DuplicateVerbError` from `packages/cli/src/index.ts`
  - [x] Add tests `packages/cli/tests/verb-registry.spec.ts`:
    - [x] `.register()` stores and `.get()` retrieves a binding
    - [x] `DuplicateVerbError` thrown on duplicate verb
    - [x] `.list()` returns sorted, stable output
  - [x] Extend `packages/cli/tests/dispatch.spec.ts` (verb-dispatch cases):
    - [x] `stp report` with `verbRegistry` mapping `report`→`{ownerCli:'track', ownerArgv:['report']}` and `track` in registry → dispatches to `registry.get('track').run(['report'])`, returns its code
    - [x] `stp report` with `verbRegistry` mapping `report`→`track` but `track` NOT in `registry` → falls through to `formatUnknown` (not a crash, exit 1)
    - [x] `stp app --help` with `verbRegistry` present → unchanged (0-regression)
    - [x] Existing dispatch tests (no `verbRegistry`) → still pass byte-identical (0-regression)
  - [x] Lot gate:
    - [x] `make typecheck-cli ENV=test-feat-stp-federation-42i` PASS
    - [x] `make lint ENV=test-feat-stp-federation-42i` — N/A (no lint-cli; typecheck-cli is the gate per Feedback Loop Lot0-D1)
    - [x] CLI tests — existing + new: `make test-cli ENV=test-feat-stp-federation-42i` — 31 passed (8 characterization + 4 registry + 10 dispatch + 9 verb-registry)
    - [x] Confirm: `dispatch.spec.ts` (10 tests: 4 existing + 6 new) + `registry.spec.ts` (4 cases) pass unchanged; `verb-registry.spec.ts` (9 cases) pass; characterization 8/8 byte-identical

- [x] **Lot 2 — Federation manifest + discovery loader**
  - [x] Add `packages/cli/src/federation.ts`:
    - [x] `FederationEntry` interface: `{ name: string; summary: string; importSpecifier: string }` (specifier taken verbatim from manifest, e.g. `@sentropic/track/cli`)
    - [x] `FEDERATION_MANIFEST: readonly FederationEntry[]` — 6 cross-repo entries (all but `app` in-repo and `harness` GATED_D7): `h2a` (`@sentropic/h2a/cli`), `knowledge` (`@sentropic/graphify/cli`), `remote` (`sentropic-remote/cli`), `track` (`@sentropic/track/cli`), `design` (`@sentropic/design-system-skills/cli`), `agent-stats` (`@sentropic/agent-stats/cli`). `harness` documented as GATED_D7 code comment, NOT a manifest entry.
    - [x] `loadFederatedSubcommands(registry: SubcommandRegistry, deps?: LoadFederationDeps): Promise<void>` — discovery loader. `LoadFederationDeps` adds injectable `importer` (default: `import(spec)`) for test isolation without vitest mock-hoisting.
      - True absence (ERR_MODULE_NOT_FOUND / ERR_PACKAGE_PATH_NOT_EXPORTED) → **silently skip**
      - Installed-but-broken (any other import error, missing `run`/`version`, `InvalidSubcommandError` from registration) → **fail loudly**: write offending package + error to `deps.error` and rethrow
    - [x] Error-code detection: inspect `(err as NodeJS.ErrnoException).code` to distinguish absence from broken
  - [x] Export `FederationEntry`, `FEDERATION_MANIFEST`, `loadFederatedSubcommands`, `LoadFederationDeps` from `packages/cli/src/index.ts`
  - [x] Add tests `packages/cli/tests/federation.spec.ts` (injectable importer — no vi.unstable_mockModule, removed in vitest 2+):
    - [x] Installed package with valid `{ run, version }` → resolves and registers correctly
    - [x] Missing package (`ERR_MODULE_NOT_FOUND`) → silently skipped, no throw, not in registry
    - [x] Missing subpath export (`ERR_PACKAGE_PATH_NOT_EXPORTED`) → silently skipped
    - [x] Installed package with missing `run` field → fail-loud path (error written to sink, throws)
    - [x] Installed package with import throwing non-absence error (SyntaxError/TypeError/Error) → fail-loud
    - [x] Registry registration failure (InvalidSubcommandError) → fail-loud
    - [x] FEDERATION_MANIFEST content/shape assertions (6 entries, correct specifiers, sorted, no app/harness)
  - [x] Lot gate:
    - [x] `make typecheck-cli ENV=test-feat-stp-federation-42i` PASS
    - [x] N/A `make lint-cli` — no lint-cli target (per Feedback Loop Lot0-D1)
    - [x] `make test-cli ENV=test-feat-stp-federation-42i` — 47 passed (8 characterization + 4 registry + 10 dispatch + 9 verb-registry + 16 federation); all files PASS

- [x] **Lot 3 — Wire the bin + ship the `report` alias**
  - [x] Extend `packages/cli/bin/stp.mjs`:
    - [x] Import `VerbRegistry`, `loadFederatedSubcommands` from `../dist/index.js`
    - [x] In `buildRegistry()`, run `await loadFederatedSubcommands(registry)` after the `stp app` hard-registration — cross-repo CLIs not installed at this point → all silently skip (graceful); machinery ships now
    - [x] Build a `VerbRegistry` with the single initial alias: `verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'], note: 'equiv: stp track report' })`
    - [x] Pass `{ verbRegistry }` as the `CliDeps` argument to `runCli`: `const code = await runCli(process.argv.slice(2), registry, { verbRegistry })`
    - [x] `stp app` hard-import of `@sentropic/build-cli` unchanged
  - [ ] UAT checkpoint (bin behavior, push branch first):
    - [ ] Push branch: `git push origin feat/stp-federation-42i`
    - [ ] From root workspace: run `stp --help` → lists `app` (and any installed cross-repo CLIs); `report` alias noted if printed
    - [ ] From root workspace: run `stp --version` → lists `stp <version>` + `app <version>`
    - [ ] From root workspace: run `stp bogus` → `Unknown subcommand: bogus` with `app` in available list
    - [ ] From root workspace: run `stp report` → since `track` not installed, falls through to `formatUnknown` (correct, not a crash)
    - [ ] From root workspace: run `stp app --help` → unchanged output (0-regression)
  - [x] Lot gate:
    - [x] `make typecheck-cli ENV=test-feat-stp-federation-42i` PASS
    - [x] N/A `make lint-cli` — no lint-cli target (per Feedback Loop Lot0-D1)
    - [x] `make test-cli ENV=test-feat-stp-federation-42i` — 47 passed (5 files: characterization 8 + registry 4 + dispatch 10 + verb-registry 9 + federation 16); all PASS
    - [x] Confirm all prior lot tests still pass (0-regression) — 47/47 unchanged

- [ ] **Lot N — Final validation + package bump + PR**
  - [x] `make typecheck-cli ENV=test-feat-stp-federation-42i` — PASS (exit 0)
  - [x] `make lint ENV=test-feat-stp-federation-42i` — N/A (no lint-cli target; typecheck-cli is the gate per Feedback Loop Lot0-D1)
  - [x] Full CLI tests rerun: `make test-cli ENV=test-feat-stp-federation-42i` — 47 passed (5 files: characterization 8 + dispatch 10 + verb-registry 9 + registry 4 + federation 16)
  - [x] Bump `packages/cli/package.json` version from `0.1.0` → `0.2.0` (minor: new public API surface `VerbRegistry` + `loadFederatedSubcommands` + `FEDERATION_MANIFEST`) — required by `enforce-package-bump` CI gate
  - [x] Confirm `CLI_VERSION` constant in `packages/cli/src/cli.ts` is updated to match `0.2.0`
  - [x] Confirm `packages/cli/src/index.ts` exports all new public symbols: `VerbRegistry`, `VerbBinding`, `DuplicateVerbError`, `FederationEntry`, `FEDERATION_MANIFEST`, `loadFederatedSubcommands`, `LoadFederationDeps`
  - [x] `make build-cli ENV=test-feat-stp-federation-42i` — PASS (exit 0; dist rebuilt with 0.2.0)
  - [ ] Final gate step 1: create PR using `plan/42i-BRANCH_feat-stp-federation.md` text as PR body
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `plan/42i-BRANCH_feat-stp-federation.md`, push, and merge

## Deferred to BR-42k
- À-la-carte manifest, lazy-skill loading, conflict-avoidance mode (§12 gap-spec)

## Deferred to BR-42h (D7)
- `stp harness` subcommand registration and `verify`/`commit` verb bindings — harness package (`packages/harness`) is `private:true`, not on main, not published; D7 wires it AFTER BR-42h creates+publishes the harness CLI contract
- No `pending:true` reservation field in `VerbRegistry` — harness verbs added fresh at D7

## Deferred (cross-repo, not this branch)
- Cross-repo CLIs adopting the `./cli` export contract (R42i-2) — each repo self-updates on its own schedule; until then, their manifest entries are treated as absent (graceful skip)
- Broader verb vocabulary (`status`/`ingest`/`init`/`doctor`/`verify`/`commit`/`knowledge`) — B6-followup, user-validated per alias before freeze
- `graphify`→`knowledge` rename (B3 from gap-spec §9.2) — graphify owner's decision
