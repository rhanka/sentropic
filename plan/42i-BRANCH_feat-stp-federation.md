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
- No active feedback items.

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

- [ ] **Lot 0 — Characterization (0-regression oracle)**
  - [ ] Confirm worktree is `feat/stp-federation-42i`: `git -C /home/antoinefa/src/sentropic/tmp/feat-stp-federation-42i branch --show-current`
  - [ ] Read `packages/cli/src/registry.ts`, `cli.ts`, `index.ts`, `bin/stp.mjs`, `packages/cli/package.json`
  - [ ] Read existing tests: `packages/cli/tests/dispatch.spec.ts`, `packages/cli/tests/registry.spec.ts`
  - [ ] Record current `packages/cli` version (`0.1.0`) and confirm it is the pre-bump baseline
  - [ ] Run existing CLI tests GREEN as the 0-regression oracle: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`
  - [ ] Capture and record stdout of `stp --help`, `stp --version`, `stp bogus` (exact bytes) as regression fixtures
  - [ ] Confirm scope boundaries (`Allowed/Forbidden/Conditional`) match this BRANCH.md
  - [ ] Lot gate:
    - [ ] `make typecheck ENV=test-feat-stp-federation-42i`
    - [ ] `make lint ENV=test-feat-stp-federation-42i`
    - [ ] CLI tests pass: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`

- [ ] **Lot 1 — `VerbRegistry` + `runCli` extension (0-regression GATE)**
  - [ ] Add `packages/cli/src/verb-registry.ts`:
    - [ ] `VerbBinding` interface (`verb`, `ownerCli`, `ownerArgv`, optional `note`)
    - [ ] `DuplicateVerbError extends Error` (parallel to `DuplicateSubcommandError`)
    - [ ] `VerbRegistry` class: `.register(binding): this`, `.get(verb): VerbBinding | undefined`, `.list(): readonly VerbBinding[]` (sorted)
  - [ ] Extend `packages/cli/src/cli.ts`:
    - [ ] Add `verbRegistry?: VerbRegistry` as OPTIONAL field on `CliDeps` interface (NOT a new positional param — `runCli(argv, registry, deps)` signature UNCHANGED)
    - [ ] After subcommand lookup fails AND before `formatUnknown`, check `deps.verbRegistry?.get(first)`: if match found, look up `ownerCli` in `registry`, call `subcommand.run([...ownerArgv, ...rest])`, return its exit code; if `ownerCli` not registered in `registry`, fall through to `formatUnknown` (not a crash)
    - [ ] No change to `formatHelp`, `formatVersion`, `formatUnknown` — additive only
  - [ ] Export `VerbRegistry`, `VerbBinding`, `DuplicateVerbError` from `packages/cli/src/index.ts`
  - [ ] Add tests `packages/cli/tests/verb-registry.spec.ts`:
    - [ ] `.register()` stores and `.get()` retrieves a binding
    - [ ] `DuplicateVerbError` thrown on duplicate verb
    - [ ] `.list()` returns sorted, stable output
  - [ ] Extend `packages/cli/tests/dispatch.spec.ts` (verb-dispatch cases):
    - [ ] `stp report` with `verbRegistry` mapping `report`→`{ownerCli:'track', ownerArgv:['report']}` and `track` in registry → dispatches to `registry.get('track').run(['report'])`, returns its code
    - [ ] `stp report` with `verbRegistry` mapping `report`→`track` but `track` NOT in `registry` → falls through to `formatUnknown` (not a crash, exit 1)
    - [ ] `stp app --help` with `verbRegistry` present → unchanged (0-regression)
    - [ ] Existing dispatch tests (no `verbRegistry`) → still pass byte-identical (0-regression)
  - [ ] Lot gate:
    - [ ] `make typecheck ENV=test-feat-stp-federation-42i`
    - [ ] `make lint ENV=test-feat-stp-federation-42i`
    - [ ] CLI tests — existing + new: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`
    - [ ] Confirm: `dispatch.spec.ts` (existing 4 cases) + `registry.spec.ts` (existing 4 cases) pass unchanged; `verb-registry.spec.ts` (new 3+ cases) pass; new verb-dispatch cases pass

- [ ] **Lot 2 — Federation manifest + discovery loader**
  - [ ] Add `packages/cli/src/federation.ts`:
    - [ ] `FederationEntry` interface: `{ name: string; summary: string; importSpecifier: string }` (specifier taken verbatim from manifest, e.g. `@sentropic/track/cli`)
    - [ ] `FEDERATION_MANIFEST: readonly FederationEntry[]` — 7 cross-repo entries (all but `app` and `harness` which are in-repo): `h2a` (`@sentropic/h2a/cli`), `knowledge` (`@sentropic/graphify/cli`), `remote` (`sentropic-remote/cli`), `track` (`@sentropic/track/cli`), `design` (`@sentropic/design-system-skills/cli`), `agent-stats` (`@sentropic/agent-stats/cli`), plus `harness` entry with note GATED_D7 (NOT wired in Lot 3 — present for documentation, skipped in loader)
    - [ ] `loadFederatedSubcommands(registry: SubcommandRegistry): Promise<void>` — discovery loader that iterates FEDERATION_MANIFEST (cross-repo entries only, not harness), for each: dynamic `import(entry.importSpecifier)`, validates `{ run, version }` shape, calls `registry.register(...)`:
      - True absence (ERR_MODULE_NOT_FOUND / ERR_PACKAGE_PATH_NOT_EXPORTED on an uninstalled package) → **silently skip** (do not add to registry)
      - Installed-but-broken (any other import error, missing `run`/`version`, `InvalidSubcommandError` from registration) → **fail loudly**: write offending package + error to `deps.error`, return non-zero (surface immediately, not silent)
    - [ ] Error-code detection: inspect `(err as NodeJS.ErrnoException).code` to distinguish `ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED` (absence) from all other errors (broken)
  - [ ] Export `FederationEntry`, `FEDERATION_MANIFEST`, `loadFederatedSubcommands` from `packages/cli/src/index.ts`
  - [ ] Add tests `packages/cli/tests/federation.spec.ts` (stub modules with vi.mock / unstable_mockModule):
    - [ ] Installed package with valid `{ run, version }` → resolves and registers correctly
    - [ ] Missing package (`ERR_MODULE_NOT_FOUND`) → silently skipped, no throw, not in registry
    - [ ] Missing subpath export (`ERR_PACKAGE_PATH_NOT_EXPORTED`) → silently skipped
    - [ ] Installed package with missing `run` field → `InvalidSubcommandError` thrown / fail-loud path (error written to stderr sink, not silent)
    - [ ] Installed package with import throwing non-absence error (e.g. `SyntaxError`) → fail-loud path
  - [ ] Lot gate:
    - [ ] `make typecheck ENV=test-feat-stp-federation-42i`
    - [ ] `make lint ENV=test-feat-stp-federation-42i`
    - [ ] CLI tests — all: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`
    - [ ] Confirm: `federation.spec.ts` (new 5+ cases) pass; prior lots' tests still pass

- [ ] **Lot 3 — Wire the bin + ship the `report` alias**
  - [ ] Extend `packages/cli/bin/stp.mjs`:
    - [ ] Import `VerbRegistry`, `loadFederatedSubcommands` from `../dist/index.js`
    - [ ] In `buildRegistry()`, run `await loadFederatedSubcommands(registry)` after the `stp app` hard-registration — cross-repo CLIs not installed at this point → all silently skip (graceful); machinery ships now
    - [ ] Build a `VerbRegistry` with the single initial alias: `verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'], note: 'equiv: stp track report' })`
    - [ ] Pass `{ verbRegistry }` as the `CliDeps` argument to `runCli`: `const code = await runCli(process.argv.slice(2), registry, { verbRegistry })`
    - [ ] `stp app` hard-import of `@sentropic/build-cli` unchanged
  - [ ] UAT checkpoint (bin behavior, push branch first):
    - [ ] Push branch: `git push origin feat/stp-federation-42i`
    - [ ] From root workspace: run `stp --help` → lists `app` (and any installed cross-repo CLIs); `report` alias noted if printed
    - [ ] From root workspace: run `stp --version` → lists `stp <version>` + `app <version>`
    - [ ] From root workspace: run `stp bogus` → `Unknown subcommand: bogus` with `app` in available list
    - [ ] From root workspace: run `stp report` → since `track` not installed, falls through to `formatUnknown` (correct, not a crash)
    - [ ] From root workspace: run `stp app --help` → unchanged output (0-regression)
  - [ ] Lot gate:
    - [ ] `make typecheck ENV=test-feat-stp-federation-42i`
    - [ ] `make lint ENV=test-feat-stp-federation-42i`
    - [ ] CLI tests — all: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`
    - [ ] Confirm all prior lot tests still pass (0-regression)

- [ ] **Lot N — Final validation + package bump + PR**
  - [ ] `make typecheck ENV=test-feat-stp-federation-42i`
  - [ ] `make lint ENV=test-feat-stp-federation-42i`
  - [ ] Full CLI tests rerun: `make test SCOPE=packages/cli/tests ENV=test-feat-stp-federation-42i`
  - [ ] Bump `packages/cli/package.json` version from `0.1.0` → `0.2.0` (minor: new public API surface `VerbRegistry` + `loadFederatedSubcommands` + `FEDERATION_MANIFEST`) — required by `enforce-package-bump` CI gate
  - [ ] Confirm `CLI_VERSION` constant in `packages/cli/src/cli.ts` is updated to match `0.2.0`
  - [ ] Confirm `packages/cli/src/index.ts` exports all new public symbols: `VerbRegistry`, `VerbBinding`, `DuplicateVerbError`, `FederationEntry`, `FEDERATION_MANIFEST`, `loadFederatedSubcommands`
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
