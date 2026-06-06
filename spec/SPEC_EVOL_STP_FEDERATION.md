# SPEC EVOL — `stp` Federation Roster + Verb-Vocabulary Harmonization

**Status: Scoping / brainstorm (planning-only). No code, no plan yet.**
Branch: `feat/stp-federation-42i` (BR-42i). Part of the BR-42 CLI-ecosystem coordinator umbrella.

Lineage: follows `spec/SPEC_EVOL_BUILD_APP_CLI.md` (BR-42a, shipped) and extends
`spec/SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md` §11 ("federation roster + vocabulary harmonization")
+ §13 ("plan registration"). Sibling: BR-42k (`stp` à-la-carte + lazy-skill /
conflict-avoidance mode, §12 of the gap-spec) — referenced but NOT scoped here.

---

## Review log

- **2026-06-06 (draft)** — Authored from mandatory reading: `packages/cli/src/registry.ts` +
  `cli.ts` + `index.ts` (the actual seam), `packages/cli/bin/stp.mjs` (the live composition
  root), `packages/build-cli/src/cli.ts` (the working `stp app` example), and
  `spec/SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md` §11/§12/§13/R6/R7/B6/B7 (the source of truth).
  Double adversarial review (Opus 4.8 + Codex 5.5-high) **not yet run** — stub below.

---

## 1. Purpose and context

BR-42i extends `@sentropic/cli` (the `stp` umbrella, BR-42a) to:

1. **Federate the full `@sentropic` CLI roster** under `stp` as named subcommands
   (`stp <name>`) via a runtime plugin-discovery mechanism, without hardcoding cross-repo
   CLIs into `packages/cli/`.
2. **Harmonize the verb vocabulary** across federated CLIs so a common bare verb
   (e.g. `report`, `status`, `init`, `verify`) can be invoked as `stp <verb>` and dispatched
   to the owning CLI — e.g. `stp report` ≡ `stp track report`.

This is **not** a documentation or housekeeping branch. It adds real TypeScript to
`packages/cli/` (a `VerbRegistry`, a plugin-discovery loader, and new dispatch logic in
`runCli`) and bumps `@sentropic/cli`'s version.

**Non-goals of BR-42i:** à-la-carte/lazy-skill mode (BR-42k, §12 gap-spec); the actual
`stp harness` command content (BR-42h, separate session); any cross-repo CLI internals; any
change to `packages/harness/**` (that package is `private: true` and the `stp harness`
registration is gated to D7 per the BR-42h mandate).

---

## 2. Current seam — grounding in the real code

### 2.1 `packages/cli/src/registry.ts` — the `Subcommand` contract

The umbrella CLI ships a fully-typed plugin seam (`registry.ts`, lines 1–90):

- **`Subcommand` interface** (`registry.ts:15–27`): `{ name: string; summary: string; version: string; run(argv): Promise<number> }`. Every federated plugin must satisfy this interface.
- **`SubcommandRegistry` class** (`registry.ts:46–90`): an in-process `Map<string, Subcommand>`. `.register(subcommand)` validates and inserts; `.get(name)` looks up; `.list()` returns sorted entries for `--help` / `--version` output.
- **Collision guard**: `.register()` throws `DuplicateSubcommandError` (`registry.ts:29–35`) on a duplicate name — fails loudly at startup, never silently shadows.
- **Validation**: `.register()` validates `name` (non-empty, no whitespace), `summary`, `version`, and `run` — `InvalidSubcommandError` (`registry.ts:37–43`) on malformed entries.

### 2.2 `packages/cli/src/cli.ts` — the `runCli` dispatcher

`runCli(argv, registry, deps)` (`cli.ts:70–96`) is the top-level dispatcher:

- `argv[0]` = subcommand name; `argv[1..]` = forwarded to `subcommand.run(rest)`.
- Handles `--help`/`-h`, `--version`/`-v` at the top level (`cli.ts:80–87`).
- Unknown subcommand → `formatUnknown()` lists available names → exits 1 (`cli.ts:59–63`, `89–93`).
- **Pure and unit-testable**: injectable `CliDeps` (log/error sinks), never calls `process.exit`.

### 2.3 `packages/cli/bin/stp.mjs` — the composition root (the working example)

```js
// bin/stp.mjs
import { runCli, SubcommandRegistry } from '../dist/index.js';
import { runAppCli, BUILD_CLI_VERSION } from '@sentropic/build-cli';

function buildRegistry() {
    const registry = new SubcommandRegistry();
    registry.register({
        name: 'app',
        summary: 'Scaffold and operate a runnable @sentropic chat application (init, doctor).',
        version: BUILD_CLI_VERSION,
        run: (argv) => runAppCli(argv),
    });
    // Reserved federation points (stp graphify / stp h2a / stp remote) live in their own
    // repos and self-register through this same seam later — OUT of BR-42a scope.
    return registry;
}
const code = await runCli(process.argv.slice(2), buildRegistry());
process.exit(code);
```

Key observations:

- The bin is the **composition root** — it is the only file that imports concrete subcommand
  packages. `packages/cli/src/**` (the distributed library) imports zero subcommand packages.
- `stp app` is wired by the bin importing `@sentropic/build-cli` and calling `runAppCli` as
  the `run` function. This is the model every federated CLI follows.
- The comment explicitly names the reserved points: `stp graphify` / `stp h2a` / `stp remote`
  — all cross-repo, all use the same `Subcommand` contract.

### 2.4 `packages/build-cli/src/cli.ts` — the `stp app` reference implementation

`runAppCli(argv, deps)` (`build-cli/src/cli.ts:67–114`) shows how a subcommand dispatches
internally: it receives the tail of `argv` (everything after `app`), handles its own verbs
(`init`, `doctor`, `--version`, `--help`), and returns an exit code. This is the pattern
every cross-repo CLI will expose as its `run(argv)` function.

---

## 3. Federation roster

### 3.1 Canonical roster — 8 CLIs as `stp <name>` subcommands

| `stp <name>` | Package / repo | Repo classification | Role | Status |
|---|---|---|---|---|
| `stp app` | `@sentropic/build-cli` (this repo, `packages/build-cli`) | **in-repo** | App scaffolder/builder | Shipped (BR-42a) |
| `stp h2a` | `@sentropic/h2a` (`rhanka/h2a`) | **cross-repo** | Agent-to-agent trust/coordination | Live CLI; reserved point named in `bin/stp.mjs` |
| `stp knowledge` | `@sentropic/graphify` → knowledge-manager (`rhanka/graphify` / BR-34) | **cross-repo** | Retrieval/index only (rename from `graphify` per gap-spec §5/B3) | Pending rename (B3 decision) |
| `stp remote` | `sentropic-remote` (`rhanka/remote`) | **cross-repo** | Session secrets + deploy target | Live CLI; reserved point named in `bin/stp.mjs` |
| `stp track` | `@sentropic/track` (`rhanka/track`) | **cross-repo** | Acceptance/realization, decisions, status | Live CLI |
| `stp design` | `@sentropic/design-system-skills` | **cross-repo** | DS lint / a11y / tokens | Live (skill `sent-tech-design`) |
| `stp harness` | `@sentropic/harness` (this repo, `packages/harness`) | **in-repo** | Code-work/PR-workflow method layer | **Gated to D7** (BR-42h; see §6) |
| `stp agent-stats` | `@sentropic/agent-stats` (`rhanka/agent-stats`) | **cross-repo** | Session telemetry / anomalies / `CompoundSignal` | Live CLI; no h2a instance |

**In-repo vs cross-repo distinction** is load-bearing for the plugin-discovery mechanism:

- **In-repo** (`app`, future `harness`): the bin can hard-import them (the `@sentropic/build-cli`
  pattern). They are npm workspace siblings; no runtime discovery needed.
- **Cross-repo** (all others): the bin must NOT hard-import them (they are separately installed
  `@sentropic/*-cli` packages). Discovery is runtime, based on what is installed in `node_modules`.

### 3.2 Plugin-discovery mechanism for cross-repo CLIs

The `stp` bin discovers installed sibling CLIs at **bin startup** (not at library-build time).
The `packages/cli/src/` library stays plugin-agnostic; discovery code lives in `bin/stp.mjs`
(the composition root).

**Proposed mechanism — package-name convention + lazy require:**

1. `stp` maintains a **static federation manifest** in `packages/cli/src/federation.ts`
   (or `bin/stp.mjs` inline for the first iteration): an ordered list of `{ name, package,
   summary, entryExport }` records for the known `@sentropic` CLIs.
2. At startup the bin iterates the manifest and, for each cross-repo entry, attempts
   `import('@sentropic/<pkg>/cli')` (or whatever entry the CLI package exports). If the
   package is installed the import resolves; if not it is silently skipped (the subcommand
   simply does not appear in `stp --help`).
3. Each resolved import must expose `{ run: (argv: string[]) => Promise<number>, version: string }`
   — this is the **cross-repo CLI contract** (see §5 below for the exact shape and its
   relationship to `Subcommand`).
4. Resolved entries are registered via `registry.register(...)` using the manifest's
   `name`/`summary` + the resolved `version`.

**Why not a pure filesystem scan (`node_modules/@sentropic/*-cli`)?**
A scan is fragile (symlinks, hoisting, workspaces) and non-deterministic. A static manifest
owned by `packages/cli` is deterministic and explicit — the coordinator owns which names are
federated. Adding a new CLI requires a one-line manifest entry (a `packages/cli/` minor
version bump) rather than a naming-convention bet. This is the safer approach given the
no-unvalidated-naming rule.

**Import failure policy:** if a cross-repo CLI is in the manifest but not installed,
`stp` silently omits it (no error, no startup crash). `stp --help` lists only the installed
subcommands. `stp <name>` against an omitted entry falls through to the existing
`formatUnknown` error path (lists available subcommands).

**`stp app` (in-repo) stays hard-imported** in `bin/stp.mjs` (no discovery needed). Same
will apply to `stp harness` once it is wired at D7.

---

## 4. Verb-vocabulary harmonization

### 4.1 The verb-registry concept

A **verb registry** maps bare verb tokens to one or more owning CLIs. It is separate from the
`SubcommandRegistry` (which maps `stp <name>` → a subcommand). The verb registry maps
`stp <verb>` → `{ ownerCli, ownerVerb }[]`.

When `stp <token>` is called and `<token>` is neither a registered subcommand name nor a top-
level flag, `runCli` checks the verb registry:

- **Single owner**: dispatch `stp <ownerCli> <ownerVerb> <rest...>` transparently.
  E.g. `stp report` → `stp track report`.
- **Fan-in** (multiple owners): see §4.3 collision policy.
- **No match**: fall through to the existing `formatUnknown` error (no regression).

### 4.2 Initial verb vocabulary (proposed)

The coordinator proposes the following bare verbs and their candidate owners.
This is the key content requiring double review and coordinator/user sign-off.

| Bare verb (`stp <verb>`) | Candidate owner | Owner verb | Notes |
|---|---|---|---|
| `report` | `stp track` | `track report` | Gap-spec §11.2 canonical example; track's work-in-flight report |
| `status` | `stp track` | `track status` | Branch/lot/task status projection |
| `init` | `stp app` | `app init` | Scaffold a new app; pre-empts harness `init` if harness ships one — see collision note |
| `verify` | `stp harness` (D7) | `harness verify` | Run verify-hook suite; deferred until harness ships |
| `doctor` | `stp app` | `app doctor` | Pre-flight checks; currently app-specific, may fan-in with harness later |
| `ingest` | `stp track` | `track ingest` | Ingest harness neutral stream |
| `commit` | `stp harness` (D7) | `harness commit` | Harness-wrapped `make commit`; deferred |
| `knowledge` / `query` | `stp knowledge` | `knowledge query` | KM retrieval; `knowledge` is also the subcommand name (no bare-verb alias needed) |

**This table is a proposal for the double review, not frozen.**
The exact vocabulary and ownership is decision B6 (see §7).

### 4.3 Collision policy (decision B6 — key open decision)

Three candidate policies for when multiple CLIs register the same bare verb:

**Option A — Single owner (strict)**
Each bare verb has exactly one owner, declared in the verb registry by the coordinator.
Collision at registration time → `DuplicateVerbError` thrown at startup (same pattern as
`DuplicateSubcommandError`). The coordinator is the arbiter; no per-CLI fiat.
- Pro: predictable, no silent disambiguation; unambiguous dispatch.
- Con: brittle as the ecosystem grows; coordinator must stay current.
- Recommended for the initial roster (small, known set).

**Option B — Fan-in (all owners, sequential)**
`stp <verb>` calls all owning CLIs in declaration order; the last non-zero exit code wins.
- Pro: additive, no coord changes needed when a new CLI exposes the same verb.
- Con: surprising UX (multiple side effects on one invocation); hard to reason about.
- Not recommended.

**Option C — Fan-in with disambiguation prompt (interactive only)**
When `stp <verb>` matches multiple owners in interactive mode, prompt the user; in `--yes`/
non-interactive mode, fail with a list of fully-qualified alternatives.
- Pro: user-friendly UX; correct for edge cases.
- Con: interactive dependency in what is otherwise a pure dispatch path.
- Possible for the general case but overkill for the initial small roster.

**Préconisation: Option A (single-owner) for the initial roster**, with a documented
**escalation path to Option C** as the ecosystem grows. The `stp <cli> <verb>` fully-
qualified form is the always-available unambiguous escape hatch (never removed, regardless
of the bare-verb policy).

### 4.4 Always-available escape hatch

Regardless of bare-verb dispatch policy, `stp <cli> <verb> [args...]` ALWAYS works (routes
through the existing `SubcommandRegistry.get(cli)` → `run([verb, ...args])`). This is the
unambiguous long form that test code and scripts should always prefer. Documentation must
state this explicitly.

### 4.5 Verb registry implementation sketch

A new file `packages/cli/src/verb-registry.ts` alongside `registry.ts`:

```ts
export interface VerbBinding {
    /** The bare verb (e.g. 'report'). */
    readonly verb: string;
    /** The subcommand name that owns this verb (e.g. 'track'). */
    readonly ownerCli: string;
    /** The argv token(s) forwarded to that CLI (e.g. ['report']). */
    readonly ownerArgv: readonly string[];
    /**
     * Optional human note surfaced by `stp --help` on the verb line
     * (e.g. 'equiv: stp track report').
     */
    readonly note?: string;
}

export class DuplicateVerbError extends Error { ... }

export class VerbRegistry {
    register(binding: VerbBinding): this { ... }
    get(verb: string): VerbBinding | undefined { ... }
    list(): readonly VerbBinding[] { ... }
}
```

`runCli` in `cli.ts` gains an optional `VerbRegistry` parameter (zero breaking change — no
registry = existing behavior). When the token does not match a subcommand name and a verb
registry is provided, it checks the verb registry before falling through to `formatUnknown`.

The bin wires both registries:

```js
// bin/stp.mjs (extended)
const verbRegistry = new VerbRegistry();
verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });
// ... other stable verbs ...
const code = await runCli(process.argv.slice(2), registry, { verbRegistry });
```

---

## 5. D7 `stp harness` compatibility — the registration seam

**Contract the harness (BR-42h) will plug into at D7 — zero BR-42i rework required:**

1. **The `Subcommand` interface is unchanged.** BR-42h registers `stp harness` by calling:
   ```js
   registry.register({
     name: 'harness',
     summary: 'Code-work/PR-workflow method layer.',
     version: HARNESS_VERSION,
     run: (argv) => runHarnessCli(argv),
   });
   ```
   This is byte-identical to how `stp app` registers. No new seam required.

2. **The `VerbRegistry` accepts harness verb bindings additively.** BR-42h adds:
   ```js
   verbRegistry.register({ verb: 'verify', ownerCli: 'harness', ownerArgv: ['verify'] });
   verbRegistry.register({ verb: 'commit', ownerCli: 'harness', ownerArgv: ['commit'] });
   ```
   If BR-42i ships with `verify`/`commit` reserved as D7 bindings (optional: register them
   with a `pending: true` flag that prints a "not yet installed" message), BR-42h's D7 lot
   simply removes the `pending` flag. If BR-42i does not pre-reserve them, BR-42h adds them
   fresh — no collision risk (harness is the only owner).

3. **The federation manifest** in `packages/cli/src/federation.ts` already includes a
   `harness` entry (with `pending: true` or simply commented out) by the time BR-42h ships.
   BR-42h's D7 lot activates it (flips `pending` or uncomments) and hard-imports the package
   in `bin/stp.mjs` (in-repo pattern, same as `stp app`).

4. **No BR-42i code is reworked at D7.** The `SubcommandRegistry`, `VerbRegistry`, and
   `runCli` extension are finalized by BR-42i and accepted as-is by BR-42h.

**The D7 contract in one sentence:** `packages/cli/` exposes `VerbRegistry` + an optional
`verbRegistry` param to `runCli`; `packages/harness/bin/` (or `bin/stp.mjs`) calls
`.register(harness subcommand)` and `verbRegistry.register(harness verbs)` at the composition
root. That is all.

---

## 6. Scope boundaries

### 6.1 Allowed paths (BR-42i scope)

- `packages/cli/src/**` — add `verb-registry.ts`, `federation.ts`; extend `cli.ts` and
  `index.ts`; update `registry.ts` if needed (no interface change expected)
- `packages/cli/bin/stp.mjs` — extend the composition root to wire the `VerbRegistry` and
  run the discovery loader (this file is already modified in a prior branch per `git status`)
- `packages/cli/package.json` — version bump (minor: new public API)
- `packages/cli/tests/**` — unit tests for `VerbRegistry`, discovery loader, extended dispatch
- `spec/SPEC_EVOL_STP_FEDERATION.md` — this file

### 6.2 Forbidden paths (BR-42i scope)

- `packages/harness/**` — owned by BR-42h, `private: true`; no touch
- Any cross-repo CLI source (`rhanka/h2a`, `rhanka/track`, etc.) — they self-register
- `Makefile`, `docker-compose*.yml` — default forbidden (MASTER.md); EX only if CI lane wiring needed (likely not: `packages/cli` already has its lane)
- BR-42k scope: lazy-skill loading, à-la-carte manifest, conflict-avoidance mode (§12 gap-spec)

### 6.3 Conditional paths (require EX)

- `.github/workflows/ci.yml` — only if `packages/cli` needs a new publish-lane step; unlikely
  since the package already has a lane. If needed: `BR42i-EX1`.

---

## 7. 0-regression guarantee

The existing `stp app` subcommand and the existing top-level `--version`/`--help` dispatch in
`runCli` must keep working **byte-identical** after BR-42i:

1. **`runCli` dispatch**: adding a `verbRegistry` parameter is purely additive (optional param
   with a default of `undefined`). When `verbRegistry` is absent, `runCli` behaves exactly as
   today. All existing tests pass unchanged.
2. **`SubcommandRegistry`**: no interface change. Existing `.register()`/`.get()`/`.list()`
   semantics preserved.
3. **`stp app` registration** in `bin/stp.mjs`: unchanged — the `runAppCli` + `BUILD_CLI_VERSION`
   hard-import and `.register({ name: 'app', ... })` call stays exactly as today.
4. **`stp --version`** output: currently lists `stp <version>` + `  app <version>`. After
   BR-42i it additionally lists installed cross-repo CLIs. Not a regression; it is additive
   output. Tests that pin the exact output need to be updated (expected: one-time test update,
   not a functional regression).
5. **`stp --help`**: same pattern — additively lists new subcommands; existing ones unchanged.

---

## 8. Open decisions

### Decision B6 — Bare-verb ownership + collision policy (PRIMARY)

This is the key decision requiring coordinator/user sign-off before implementation.

- **What needs deciding:** which CLI owns each bare verb as `stp <verb>`, and which collision
  policy applies when multiple CLIs expose the same verb (Options A/B/C in §4.3).
- **Recommendation:** Single-owner (Option A) for the initial roster; escalation path to
  Option C as ecosystem grows. The specific verb-to-owner mapping in §4.2 requires review.
- **Risk if wrong:** bare-verb aliases become a permanent public CLI contract (renaming is
  costly post-publish). Decide the full vocabulary now.
- **Blocking for:** lot implementation (cannot write `bin/stp.mjs` verb wiring without knowing
  the policy and the vocabulary).

### Decision B6a — `init` verb ownership (sub-decision of B6)

`stp init` is currently a clean single-owner case (`stp app init`). However, if harness ships
a generic `harness init` (workspace init), both CLIs expose `init`. The collision must be
pre-declared:
- Option 1: `init` stays owned by `app` (product-app init); harness uses `harness init` only.
- Option 2: `init` fans into both; context determines which is relevant.
- Recommendation: reserve `init` for `app` in the initial vocabulary; harness uses `stp harness
  init` explicitly. Revisit at D7 if harness needs a top-level `init` alias.

### Decision R42i-1 — Federation manifest location (reversible)

Static manifest in `packages/cli/src/federation.ts` (distributed with the library) vs inline
in `bin/stp.mjs` (bin-only):
- `federation.ts` (library): importable by tests and by other tools; cleaner separation; adds
  a published surface.
- Inline in `bin/stp.mjs`: simpler; no extra export; bin-only concern.
- Recommendation: `federation.ts` in `src/` for testability. Reversible pre-publish.

### Decision R42i-2 — Discovery import path convention (reversible)

Cross-repo CLIs must expose a discoverable entry point. Proposed convention:
`@sentropic/<pkg>` exports a `cli` subpath (`{ "./cli": { "import": "./dist/cli.js" } }`)
providing `{ run, version }`. Each cross-repo CLI adopts this on its own schedule; until it
does, its manifest entry is treated as "not installed" (graceful skip).
This is a cross-repo contract the coordinator communicates to CLI owners — not a BR-42i code
change (they self-update their own packages). Reversible.

### Deferred

- The actual `stp harness` command content and verb set — BR-42h / D7.
- Cross-repo CLIs' own internal verb exposure (what `stp h2a --help` lists) — each repo owns
  its own CLI surface.
- BR-42k: à-la-carte manifest, lazy-skill loading, conflict-avoidance mode (§12 gap-spec) —
  a separate lot consuming the BR-42b catalog as its substrate.
- The `graphify` → `knowledge` rename (B3 from gap-spec §9.2) — graphify owner's decision;
  BR-42i uses `knowledge` in the manifest but the actual package name change is cross-repo.

---

## 9. Decisions ledger

### 9.1 Reversible (decided)

| ID | Decision | Préconisation |
|---|---|---|
| R42i-1 | Federation manifest location | `packages/cli/src/federation.ts` (testable) |
| R42i-2 | Cross-repo CLI import convention | `@sentropic/<pkg>` exports `"./cli"` subpath with `{ run, version }` |
| R42i-3 | In-repo CLIs (`app`, `harness`) remain hard-imported in bin | No discovery for in-repo packages; hard-import pattern from BR-42a preserved |
| R42i-4 | Missing cross-repo CLI = silent skip | Not installed → omitted from `--help`; no startup crash |
| R42i-5 | `runCli` extension is additive (`verbRegistry?: VerbRegistry`) | Zero breaking change to existing signature |
| R42i-6 | `stp <cli> <verb>` long form always works | Escape hatch preserved; documented in `--help` |

### 9.2 Blocking (pending sign-off)

| ID | Decision | § | Owner |
|---|---|---|---|
| **B6** | Bare-verb ownership + collision policy | §4.2, §4.3 | BR-42 coordinator + user |
| **B6a** | `init` verb ownership (`app` vs fan-in with future harness) | §8 | BR-42 coordinator |
| **B-graphify-rename** | `stp knowledge` name depends on B3 (graphify→KM rename) | §3.1 | graphify owner |

---

## 10. Tests

All new code in `packages/cli/` requires unit tests before the lot closes:

1. **`VerbRegistry` unit tests** (`packages/cli/tests/verb-registry.test.ts`):
   - `.register()` stores and `.get()` retrieves bindings.
   - `DuplicateVerbError` thrown on duplicate verb.
   - `.list()` returns sorted, stable output.

2. **Discovery loader unit tests** (`packages/cli/tests/federation.test.ts`):
   - Installed package resolves and registers correctly.
   - Missing package is silently skipped (no throw).
   - Malformed import (missing `run`/`version`) throws `InvalidSubcommandError`.

3. **`runCli` verb-dispatch tests** (extend `packages/cli/tests/cli.test.ts`):
   - `stp report` with a `track`-owned `report` verb → dispatches to `registry.get('track').run(['report'])`.
   - `stp report` with no `track` registered → falls through to `formatUnknown` (not a
     verb-registry error).
   - `stp app --help` unchanged (0-regression).
   - `stp --version` lists in-repo + installed cross-repo CLIs.

4. **0-regression tests**: existing `cli.test.ts` tests pass without modification when
   `verbRegistry` is omitted from `runCli`.

---

## 11. Review log stub (for Opus + Codex double-review)

The conductor will run a double adversarial review (Opus 4.8 + Codex 5.5-high) against this
spec before greenlighting the plan/implementation lot.

- **Reviewer 1 (Opus 4.8)**: — *pending*
- **Reviewer 2 (Codex 5.5-high)**: — *pending*
- **Must-fixes applied**: — *pending*
