# SPEC EVOL — `stp` Federation Roster + Verb-Vocabulary Harmonization

**Status: Scoping / brainstorm (planning-only). No code, no plan yet.**
Branch: `feat/stp-federation-42i` (BR-42i). Part of the BR-42 CLI-ecosystem coordinator umbrella.

Lineage: follows `spec/SPEC_EVOL_BUILD_APP_CLI.md` (BR-42a, shipped) and extends
`spec/SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md` §11 ("federation roster + vocabulary harmonization")
+ §13 ("plan registration"). **NOTE: the gap-spec is NOT on `main`** — it lives on branch
`chore/rules-skills-audit` (BR-25, **PR #259**); read it via
`git show origin/chore/rules-skills-audit:spec/SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md` (§11/§12 +
ledger R6/R7/B6/B7). Sibling: BR-42k (`stp` à-la-carte + lazy-skill / conflict-avoidance mode,
§12 of the gap-spec) — referenced but NOT scoped here.

---

## Review log

- **2026-06-06 (draft)** — Authored from mandatory reading: `packages/cli/src/registry.ts` +
  `cli.ts` + `index.ts` (the actual seam), `packages/cli/bin/stp.mjs` (the live composition
  root), `packages/build-cli/src/cli.ts` (the working `stp app` example), and
  `spec/SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md` §11/§12/§13/R6/R7/B6/B7 (the source of truth).
- **2026-06-06 (double-review)** — Opus 4.8 (conductor): APPROVE on the seam grounding + D7 contract + 0-regression framing. Codex 5.5-xhigh: **REVISE** — 7 must-fixes, all folded: (1) discovery distinguishes *absent* (skip) from *installed-but-broken* (fail loudly: missing `./cli` export, malformed `{run,version}`, ESM/CJS shape mismatch, transitive import failure, version skew) + full import specifiers; (2) `verbRegistry` goes on `CliDeps` (NOT a 3rd positional param — would break callers/tests); (3) harness premise corrected — `packages/harness` is not on main + a published `@sentropic/cli` cannot import a private unpublished `@sentropic/harness`; the D7 "one wiring change" is valid only AFTER BR-42h creates+publishes the harness CLI contract (flip `private:false`); (4) no `pending:true` harness reservation — `verify`/`commit` registered only at D7; (5) ship only ratified low-collision bare aliases (start with `report`); defer `init`/`doctor`/`commit`/`verify`/`knowledge` (high-collision; `knowledge` shadowed by the subcommand name); (6) gap-spec citation fixed (lives on PR #259, not main); (7) "self-register" → composition root imports/discovers + calls `registry.register`; external CLIs only EXPORT a contract.

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
2. At startup the bin iterates the manifest and, for each cross-repo entry, attempts to
   `import(<full specifier>)` where the specifier is taken **verbatim from the manifest entry**
   (e.g. `@sentropic/track/cli`) — not a guessed `@sentropic/<pkg>/cli` pattern. The composition
   root performs the import + registration; the external CLI only EXPORTS a contract (Codex MF7 —
   no "self-registration": external packages never import `@sentropic/cli`).
3. Each resolved import must expose `{ run: (argv: string[]) => Promise<number>, version: string }`
   — the **cross-repo CLI contract** (see §5).
4. Resolved entries are registered via `registry.register(...)` using the manifest's
   `name`/`summary` + the resolved `version`.

**Why not a pure filesystem scan (`node_modules/@sentropic/*-cli`)?**
A scan is fragile (symlinks, hoisting, workspaces) and non-deterministic. A static manifest
owned by `packages/cli` is deterministic and explicit — the coordinator owns which names are
federated. Adding a new CLI requires a one-line manifest entry (a `packages/cli/` minor
version bump) rather than a naming-convention bet. This is the safer approach given the
no-unvalidated-naming rule.

**Import resolution policy (Codex MF1 — absent ≠ broken):**
- **True absence** (module-not-found / `ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED` for an uninstalled package) → **silently skip**; the subcommand simply does not appear in `stp --help`, and `stp <name>` falls through to the existing `formatUnknown` path.
- **Installed-but-broken** (the package resolves but the import THROWS for any other reason — a transitive import failure, an ESM/CJS interop error, or it resolves to a value that fails the `{ run, version }` shape/`InvalidSubcommandError` validation, or a version-skew the manifest declares incompatible) → **fail LOUDLY**: surface the offending package + error to stderr and a non-zero exit, never silently omit. Silent omission would hide a real breakage as a "missing command".
- The skip-only-on-true-absence distinction is implemented by inspecting the import error code, not by a blanket try/catch-and-ignore.

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

**Codex MF5: ship ONLY ratified low-collision aliases initially; defer high-collision ones.**
A bare-verb alias is a permanent public CLI contract (costly to rename post-publish), so BR-42i
ships a MINIMAL, ratified set and defers everything contentious to a later, deliberate decision.

**Initial shipped vocabulary (BR-42i):**

| Bare verb (`stp <verb>`) | Owner | Owner verb | Why low-collision / ratified |
|---|---|---|---|
| `report` | `stp track` | `track report` | Gap-spec §11.2 **canonical example**; only `track` plausibly owns "report"; user-implied via §11. |

**Deferred (NOT shipped/reserved by BR-42i)** — decide each as its owning CLI lands + the
ecosystem usage clarifies, to avoid freezing a contested alias prematurely:

- `init` — collides between `app init` (scaffold) and a future `harness init` (workspace) → keep `stp app init` / `stp harness init` explicit for now (no bare alias).
- `doctor` — `app`-specific today, may fan-in with harness later.
- `verify` / `commit` — harness-owned but harness isn't published (D7); register ONLY at D7.
- `status` / `ingest` — track-owned candidates; reasonable but not yet ratified → defer to the B6 follow-up once `stp track` is federated and its surface is confirmed.
- `knowledge` / `query` — `knowledge` is already the SUBCOMMAND name (`stp knowledge`) so a bare-verb alias would shadow it; no alias.

**B6 reduces to**: ship `report`→`track report` now (reversible, low-collision, gap-spec
canonical); the broader vocabulary is a deliberate follow-up decision (B6-followup), validated
with the user before each alias is frozen. This keeps the durable public surface minimal.

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

**Codex MF2 — the `runCli(argv, registry, deps)` signature is PRESERVED exactly.** The
`VerbRegistry` is carried as a NEW OPTIONAL FIELD on the existing `CliDeps` object
(`deps.verbRegistry?: VerbRegistry`), NOT as a 3rd positional parameter (a positional add
would break current callers/tests). When `deps.verbRegistry` is present AND the token matches
neither a subcommand name nor a top-level flag, `runCli` checks the verb registry before
falling through to `formatUnknown`. Absent `deps.verbRegistry` → behavior is byte-identical
to today.

The bin wires both registries (the verb registry rides on `deps`):

```js
// bin/stp.mjs (extended)
const verbRegistry = new VerbRegistry();
verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });
const code = await runCli(process.argv.slice(2), registry, { verbRegistry });
//                                                            ^^^^^^^^^^^^^^^^ CliDeps field
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

2. **The `VerbRegistry` accepts harness verb bindings additively at D7.** BR-42i does NOT
   pre-reserve `verify`/`commit` (Codex MF4 — no `pending:true` field shipped unless BR-42i
   implements+tests it; we don't). At D7, BR-42h adds them fresh:
   ```js
   verbRegistry.register({ verb: 'verify', ownerCli: 'harness', ownerArgv: ['verify'] });
   ```
   No collision risk (harness is the sole owner of `verify`/`commit`).

3. **PRECONDITION (Codex MF3): the harness CLI must EXIST + be importable first.** `packages/harness`
   is NOT on `main` (it is being built on `feat/harness-core`, `private:true`), and a PUBLISHED
   `@sentropic/cli` cannot import a private/unpublished package. So the D7 "one wiring change" is
   valid ONLY AFTER BR-42h: (a) creates the harness CLI contract (`runHarnessCli` + version export),
   and (b) flips `private:false` + publishes (or, if `stp harness` is wired from the in-repo bin
   pre-publish, the bin imports the workspace package — but the PUBLISHED `stp` still needs the
   published harness). BR-42i only guarantees the SEAM is ready; it cannot pre-wire a non-existent
   package.

4. **No BR-42i code is reworked at D7** — the `SubcommandRegistry`, `VerbRegistry`, and the
   `CliDeps.verbRegistry` extension are finalized by BR-42i; BR-42h's D7 lot only ADDS a
   `registry.register(harness)` + `verbRegistry.register(harness verbs)` call at the composition
   root (and the manifest/import wiring), once the harness package exists+publishes.

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

1. **`runCli` dispatch**: the `runCli(argv, registry, deps)` signature is UNCHANGED; the verb
   registry is an optional FIELD on `CliDeps` (`deps.verbRegistry?`). When it is absent (today's
   callers pass no such field), `runCli` behaves exactly as today. All existing tests pass
   unchanged. (Byte-identical help/version holds only when NO plugins are installed AND no verb
   registry is passed — i.e. for the existing test fixtures.)
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

### Decision B6 — Collision policy (DECIDED, reversible) + initial alias (DECIDED) 

Post-Codex-MF5, B6 is **de-risked and conductor-decidable** (no longer a "freeze the whole
vocabulary now" blocker):
- **Collision policy = Option A (single-owner strict)** for the initial roster — `DuplicateVerbError`
  at startup; coordinator is arbiter; `stp <cli> <verb>` long form is the always-available escape
  hatch. Escalation path to Option C documented for ecosystem growth. *(reversible)*
- **Initial shipped alias = `report` → `track report` ONLY** (§4.2) — low-collision, gap-spec §11.2
  canonical, user-implied. *(reversible; low durable surface)*

### Decision B6-followup — broader verb vocabulary (DEFERRED, user-validated per alias)

The contested aliases (`status`/`ingest`/`init`/`doctor`/`verify`/`commit`/`knowledge`) are NOT
shipped by BR-42i (Codex MF5). Each is decided later, as its owning CLI federates and usage
clarifies, and **validated with the user before the alias is frozen** (durable public CLI
naming, cf. no-unvalidated-naming). `init`/`verify`/`commit` specifically wait on the harness
(D7). Until then: only the explicit `stp <cli> <verb>` form (no bare alias).

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

| ID | Decision | § | Owner | State |
|---|---|---|---|---|
| **B6** | Collision policy (Option A single-owner) + initial alias (`report`) | §4.3, §8 | coordinator | **DECIDED** (reversible) — conductor took it post-MF5 |
| **B6-followup** | Broader verb vocabulary (`status`/`init`/`verify`/…) | §4.2, §8 | coordinator + **user** | DEFERRED — validate each alias before freeze (durable naming) |
| **B-graphify-rename** | `stp knowledge` name depends on B3 (graphify→KM rename) | §3.1 | graphify owner | pending (cross-repo) |
| **B-harness-precondition** | `stp harness` D7 wiring needs harness package created+published first | §5 | BR-42h | pending (D7) |

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
