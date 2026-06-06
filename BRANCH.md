# Feature: BR-42h — `@sentropic/harness` core lib (verify-core first slice)

## Objective
Scaffold `packages/harness` (`@sentropic/harness`, **`"private": true`** for now — D7 defers publish) and ship its **first verify-core slice**: a `BRANCH.md` parser + `ScopeBoundary` model + the **C1 branch-check** and **C2 scope-check** as host-agnostic library functions, behind a **profile SPI** (proven generic by a 2nd stub profile that differs on a C2-consumed dimension), emitting the neutral **`VerificationRun`** artifact. Honors BR25 **D5** (advisory Layer A; C8 deferred) + **D6** (lib built in-repo) + **D7** (publish + `stp harness` registration deferred).

## Scope / Guardrails
- New **tooling-only** package `packages/harness`. Zero product-runtime coupling (no Drizzle/Hono/Svelte/Mistral); Node built-ins + TypeScript only. Zero runtime deps; **zero `@sentropic/*` deps** in this slice (graphify peerDep deferred to the graph-verb follow-on).
- **`"private": true`** this slice: honors D7 (publish deferred) AND `rules/architecture.md` "no architecture-only scaffolding" — the in-repo *consumer* is the dev-tooling lane (`make scope-check`/skill wrapper, Lot 5), not api/ui. `enforce-package-bump` auto-skips a new/private package (ci.yml). Flip to public + add the bootstrap lane in the D7 publish follow-on.
- Tests/typecheck use the **mktemp Docker pattern** (mirror `*-build-cli`, `LLM_MESH_NODE_IMAGE`): deps installed in a temp dir with `--no-save` → **no root `package-lock.json` change** (the package is in the `packages/*` workspace glob but no root `npm install` is run).
- Make-only; `ENV` last; worktree `tmp/feat-harness-core`; English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/harness/**`, `BRANCH.md`
- **Forbidden Paths**: `docker-compose*.yml`, `.cursor/rules/**`, `api/**`, `ui/**`, `e2e/**`, other `packages/**`, other `plan/NN-BRANCH_*.md`
- **Conditional Paths (exception required)**:
  - `Makefile` (harness make lane) → **BR42h-EX1** (Lot 0 + Lot 5a)
  - `.github/workflows/ci.yml` (`validate-harness` job + path filter; **no** bootstrap enum — deferred D7) → **BR42h-EX2** (Lot 5b)
  - `.claude/skills/scope-check/**` (thin wrapper over the lib) → **BR42h-EX3** (Lot 5c)
  - `package-lock.json` — **NOT expected to change** (mktemp installs, `--no-save`); if a root install is ever needed → **BR42h-EX4**

## Feedback Loop
- **BR42h-EX1** `attention` — `Makefile`: add `typecheck-harness`/`test-harness`/`build-harness`/`pack-harness` (Lot 0) + `scope-check`/`branch-check` passthroughs (Lot 5a), mirroring `*-build-cli` (mktemp, `LLM_MESH_NODE_IMAGE`). Additive only. Rollback: remove targets.
- **BR42h-EX2** `deferred` (Lot 5b) — `ci.yml`: `validate-harness` job (typecheck/test/build/pack) + `changes` filter `packages/harness/**`, mirror `validate-build-cli`. Bootstrap/publish enum **deferred (D7)**. Rollback: remove job/filter.
- **BR42h-EX3** `deferred` (Lot 5c) — `.claude/skills/scope-check`: thin wrapper → `make scope-check` (advisory, D5). Rollback: restore prior SKILL.md.

## AI Flaky tests
- N/A — deterministic pure-TS unit tests.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — one tooling package, sequential lots.
- [ ] **Multi-branch**

## UAT Management
- N/A — no user-visible surface. D4 state = `uat_not_applicable`. Verification categories (D3): `static` (typecheck) + `unit` (vitest).

## Schema freeze decisions (resolved this slice — were review HIGH findings)
- **`VerificationRun.category`** = the **D3** taxonomy `none|static|unit|integration|e2e|ci|uat` (D3 is APPROVED and explicitly bound to this field, `SPEC_BR25_BEST_OF_BREED.md`). **Deviation from gap-spec §2.1** (which listed `security`, no `none`): `security` is **added when the §4 security verify-hook lands** (out of this slice); `none` kept per D3. Recorded here as the single source of truth.
- **`VerificationRun.result`** = `pass|fail`. Check results = `{ pass: boolean, violations: Violation[], bypass?: { reason } }`; `Violation = { code, path?, message, severity: advisory|blocking }` (this slice: C1/C2 emit `advisory` only — D5; `blocking` reserved for C8 later).
- **`WorkEvent`** = **CUT from this slice** (no emitter/consumer in a C1/C2-only slice; it is emitted by `lot-gate`/`branch-close`, both deferred). It returns, schema frozen *with the track owner*, in the lot-gate follow-on.

## Profile SPI (resolved — was the "config theatre" finding)
- This slice's `HarnessProfile` exposes **only fields C1/C2 actually consume**: `forbiddenPathDefaults: string[]`, `exceptionIdPattern: RegExp` (e.g. `^BR\d+-EX\d+$`), `conditionalRequiresException: boolean`, `branchMatch: 'exact'|'prefix'`. Deferred fields (`commitMaxLines`, `forbiddenCommands`, `envGuard`, `branchMdGrammar`) are **NOT in the interface yet** — they enter with their check-lots (no dead config).
- `src/profile/sentropic.ts` = real values from `rules/MASTER.md`. `src/profile/stub.ts` = a profile that **differs on a C2-consumed dimension** (different `exceptionIdPattern` + different `forbiddenPathDefaults`).
- **Genericity proof (Lot 4)**: feed the SAME `BRANCH.md` + staged-file set to C2 under both profiles and **assert DIVERGENT outcomes** (a path/exception accepted under `sentropic` but rejected under `stub`, and vice-versa). Not "both pass" — that would be theatre.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Scaffold `packages/harness` + make lane (BR42h-EX1)**
  - [x] `package.json` — `@sentropic/harness` v0.0.0, **`"private": true`**, `type: module`, `exports: "."`, `files: [dist, README, LICENSE]`, scripts `build`/`typecheck`, devDeps `typescript@5.4.5`/`@types/node`/`vitest@4.0.18`. **No `bin`** (deferred Lot 5a). **No `@sentropic/*` / graphify dep.**
  - [x] `tsconfig.json` (mirror `packages/contracts`), `LICENSE` (MIT), `src/index.ts` (barrel), `README.md`.
  - [x] `Makefile`: `typecheck-harness`/`test-harness`/`build-harness`/`pack-harness` mirroring `*-build-cli`.
  - [x] Gate: `make typecheck-harness` green + `make pack-harness` clean (7 files, 2.5 kB).

- [x] **Lot 1 — Neutral artifact + profile SPI**
  - [x] `src/artifacts/verification-run.ts` — `VerificationRun` v0 + `Violation` (schema-freeze §above).
  - [x] `src/profile/profile.ts` — `HarnessProfile` (only the C1/C2 fields above).
  - [x] `src/profile/sentropic.ts` + `src/profile/stub.ts` (stub differs on a C2-consumed dimension).
  - [x] Gate: `make typecheck-harness` (green).

- [x] **Lot 2 — `BRANCH.md` parser + `ScopeBoundary`**
  - [x] `src/branch-md/parse.ts` — `parseBranchMd(text)` → `{ title, allowedPaths[], forbiddenPaths[], conditionalPaths[], lots[], exceptions[] }` (tolerant; no throw on malformed).
  - [x] `src/scope/scope-boundary.ts` — `ScopeBoundary` + `classifyPath(path)` → `allowed|forbidden|conditional|unknown` (precedence: allowed > forbidden > conditional > profile-default > unknown).
  - [x] Tests: `tests/branch-md/parse.spec.ts` (golden synthetic fixture + malformed), `tests/scope/scope-boundary.spec.ts` (precedence/glob/unknown/profile-default).
  - [x] Gate: `make test-harness ENV=test-feat-harness-core` (9 tests green) + `make typecheck-harness`.

- [x] **Lot 3 — C1 branch-check + C2 scope-check → VerificationRun**
  - [x] `src/checks/branch-check.ts` — `checkBranch({ currentBranch, expectedBranch, profile, bypass? })` (C1). `expectedBranch` CALLER-SUPPLIED; tests cover match / mismatch / bypass / prefix.
  - [x] `src/checks/scope-check.ts` — `checkScope({ stagedFiles, boundary, profile, declaredExceptions? })` (C2).
  - [x] `src/run/emit.ts` — `toVerificationRun(checks, ctx)` (neutral; **NO track import**) + barrel re-exports.
  - [x] Tests `tests/checks/scope-check.spec.ts` — matrix: in-scope ✓ / forbidden ✗ / allowed-beats-forbidden / conditional−exception ✗ / conditional+grammar-exception ✓ / wrong-grammar-exception ✗ / unknown ✗. `tests/checks/branch-check.spec.ts` — match/mismatch/bypass/prefix + `toVerificationRun` golden.
  - [x] Gate: `make test-harness ENV=test-feat-harness-core` (21 tests green) + `make typecheck-harness`.

- [x] **Lot 4 — Genericity proof (2nd profile asserts DIVERGENCE)**
  - [x] `tests/profile/genericity.spec.ts` — same input under `sentropic` vs `stub` asserts DIVERGENT outcomes on 3 profile-read dimensions (conditionalRequiresException, forbiddenPathDefaults, branchMatch). Not both-pass.
  - [x] `tests/artifacts/verification-run.spec.ts` — golden shape; superset of track `TestRun{commit,env,runner,result,at}`.
  - [x] Gate: `make test-harness ENV=test-feat-harness-core` (25 tests green) + `make typecheck-harness`.

- [x] **Lot 5a — pure bin (BR42h-EX1; make passthrough split out & deferred)**
  - [x] `src/cli/run.ts` (pure `runHarnessCli`, arg-based, no git / no `process.exit`) + `src/bin/harness.ts` (thin entry, shebang); `bin: { harness: "./dist/bin/harness.js" }` declared. `harness check scope|branch` advisory (exit 0; usage error → 2).
  - [x] `tests/bin/cli-smoke.spec.ts` (usage / unknown-cmd / C1 FAIL / C2 FAIL / `--json` VerificationRun).
  - [x] **Lot 5d (make scope-check)** — double-reviewed (Opus+Codex, CONVERGED): `make scope-check` = host `git diff --cached/--name-only` (staged+unstaged, deduped) → docker-over-dist → `harness check scope` (advisory, no `|| true`; `build-harness` dep; `$(LLM_MESH_NODE_IMAGE)`). Verified PASS on the live worktree. `make branch-check` DEFERRED (needs `--expected-branch` source = the deferred C1 branch-identity work).
  - [x] Gate: `make typecheck-harness` + `make test-harness ENV=test-feat-harness-core` (30 tests) + `make pack-harness` (bin in tarball).
- [ ] **Lot 5b — CI job (BR42h-EX2)**: `validate-harness` (typecheck/test/build/pack) + filter, mirror `validate-build-cli`.
- [x] **Lot 5c — skill wrapper (BR42h-EX3)**: `.claude/skills/scope-check` → thin wrapper over `make scope-check`; deleted the contradictory "Forbidden takes precedence" line; canonicalised **allowed-wins** + documented unknown-as-advisory-violation. Advisory (D5).

- [ ] **Lot N — Final**
  - [ ] Review `packages/harness/**`: zero product-runtime imports; zero track import; advisory-only.
  - [ ] PR; CI green (`validate-harness`); enforce-package-bump auto-skip confirmed (new/private).
  - [ ] On CI OK: remove `BRANCH.md`, push, merge.

## Test plan (file granularity)
- **Unit (`make test-harness`)** new: `tests/branch-md/parse.spec.ts`, `tests/scope/scope-boundary.spec.ts`, `tests/checks/scope-check.spec.ts`, `tests/checks/branch-check.spec.ts`, `tests/profile/genericity.spec.ts`, `tests/artifacts/verification-run.spec.ts`.
- **Static (`make typecheck-harness`)** every gate. **E2E/integration**: none (tooling lib).

## Deferred to follow-on branches
- Checks C5/C7/C10 + C8-blocking + C4/C6 (Layer B) and their profile fields (`branchMdGrammar`, `commitMax*`, `forbiddenCommands`, `envGuard`).
- `WorkEvent` (+ emitter/golden, frozen with track owner), `lot-gate`/`branch-init`/`branch-close`/`report`.
- track-side ingest adapter (`stp track ingest`) — **owned by track** (dispatched 2026-06-04).
- `stp harness` registration in `@sentropic/cli` + **npm publish + bootstrap lane** (gated on D7); flip `private:false`.
- `compound` ritual + graphify-KM (graph verb) + agent-stats `CompoundSignal`; C1 branch-identity parsing + template identity line.
