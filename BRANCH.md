# Feature: Agents Surface — chat-ui tabs `agents | chats | comments`

## Objective
- [ ] Sediment the owner's `agents | chats | comments` intention (R1-R15) in `spec/SPEC_EVOL_AGENTS_SURFACE.md`.
- [ ] Ship the additive half of the surface: entry contract, R9 ordering, last-consultation markers, and a design-system-based list component.

## Scope / Guardrails
- [ ] Scope limited to `packages/chat-ui/**`, `spec/**`, and the chat-ui Make targets.
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- [ ] Branch development happens in isolated worktree `tmp/chat-agents-surface`.
- [ ] Test campaigns run on `ENV=test-agents`, never on root `dev`.
- [ ] In every `make` command, `ENV=<env>` is passed as the last argument.
- [ ] The breaking tab rename is OUT of this branch: owner GO obtained, but it is an atomic multi-package release scheduled after the shell handover.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/state/agents*.ts`
  - `packages/chat-ui/src/components/Agents*.svelte`
  - `packages/chat-ui/tests/agents-*`
  - `packages/chat-ui/src/index.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `spec/SPEC_EVOL_AGENTS_SURFACE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `api/**`
  - `packages/cowork-bridge/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `CHAT-AGENTS-EX1`
  - `.github/workflows/**`

## Feedback Loop
- `CHAT-AGENTS-EX1` — **Makefile** (default Forbidden Path).
  - Reason: the owner ratified building the list items on real design-system components, exposed on their own export subpath with the DS as an OPTIONAL peer dependency. `test-chat-ui-dom` installs a fixed package list into a temp dir, so without adding `@sentropic/design-system-svelte` to it the new component cannot be DOM-tested at all. The nearest precedent (`auth-ui`) ships DS-based components with NO DOM coverage; that is below this package's own bar of 13 DOM suites / 189 tests.
  - Impact: one package added to the `test-chat-ui-dom` install list plus one symlink. No other target, no runtime code, no CI workflow, no compose file.
  - Verified: the DS resolves inside the sandbox and the 189 pre-existing DOM tests stay green.
  - Rollback: revert the single Makefile hunk; the component then falls back to the auth-ui precedent (no DOM coverage, since `tsc` does not parse `.svelte`).
- `attention` — **a stale `BRANCH.md` from the infra secret-key lane is committed on `main`** (its "Lot N — Handover" is still unchecked). This branch replaces it per the one-BRANCH.md-per-branch convention, and the convention deletes `BRANCH.md` before merge — which would also remove that residue from `main`. Flagged so it is a decision, not an accident.
- `attention` — arbitration requested from conductor + architect (owner instruction, 2026-07-30): (1) who edits the Chrome/VSCode surfaces for the atomic breaking release, (2) the egress boundary for foreign CLI transcripts. Envelopes deposited and verified on disk; both arbiters were dormant at send time.

- `resolved` — `CHAT-AGENTS-BLK1` — **fixed in this branch; the design-system package was never at fault.** An earlier version of this entry blamed the published `@sentropic/design-system-svelte`. That was wrong and the DS lane refuted it with `npm pack` + sha256 across five versions; a disposable probe reading the file off disk INSIDE our sandbox confirmed sha256 `6a684f7ad7ab441a0a81c63023e4ba1f291b876806499888ce0efb63320f6dfc`, `lang="ts"` on line 1, full annotations on line 44 — byte-identical to npm. The package ships `.svelte` as TypeScript SOURCE by contract; our harness simply never preprocessed dependency components (`@sveltejs/vite-plugin-svelte` compiles them under `exclude: []` but does not preprocess them). Fixed by `packages/chat-ui/vitest-dep-svelte-ts.ts`, a `enforce: 'pre'` plugin that runs Svelte's own `preprocess()` over dependency `.svelte` files with an esbuild script hook. Three routes were tried and rejected on evidence: (a) regex extraction of script blocks — broke on real markup (`AppChrome.svelte:209:29 Unexpected token`); (b) `vitePreprocess()` called directly — a silent NO-OP outside the Vite plugin context, proven by instrumentation showing byte-identical output; (c) `svelte-preprocess` — its TypeScript transformer rewrites Svelte 5 runes and breaks them (``$bindable()` can only be used inside a `$props()` declaration``). Two load-bearing details are commented in the file: `verbatimModuleSyntax` (without it esbuild elides template-only imports → `ReferenceError: Icon is not defined`) and the fact that no source map is threaded back. The suite exclusion is removed; all 14 DOM suites pass, and the 7 agents-list tests were fail-first proven twice (inverted tone mapping → 1 failure; removed pending tag → 1 failure).

- `blocked` — `CHAT-AGENTS-BLK2` — **the `AgentsList` export subpath is withheld until the component can be honestly classified.** `tests/reference-validation.spec.ts` requires every exported component to carry one of four classes: `primitive` (needs a real `dogfoodedBy` app consumer), `assembly` (needs `composes` entries that are themselves classified IN THIS manifest), `headless`, or `legacy`. `AgentsList` is none of them today: it is not yet mounted by the app (that is the host-wiring lot), its DOM validation is suspended by `CHAT-AGENTS-BLK1`, and it composes EXTERNAL design-system primitives that this manifest does not classify. Rather than invent a classification to make the gate pass, the export is removed from `package.json` and `export-manifest.json`; the component, its `.d.ts` and its tests stay on the branch. UPDATE 2026-07-30: DOM validation now EXISTS (CHAT-AGENTS-BLK1 resolved, 7 green tests against real DS components), but the classification still does not fit — `assembly` requires composed entries classified in THIS manifest and the design-system components are not, `primitive` requires a real `dogfoodedBy` consumer and the host wiring is a later lot. So the export stays withheld until the component is actually mounted by the app. Restoring it earlier would mean labelling it falsely. NOTE: the delegated agent reported this failure as a "pre-existing baseline"; it was not — it was caused by adding the export.

## AI Flaky tests
- `test-e2e (group-c, 03)` failed once on commit `ff6935e55` — `tests/03-chat.spec.ts:269` ("ouvrir le chat, envoyer un message et recevoir une réponse"), `Timeout 60000ms exceeded while waiting on the predicate`, on all three attempts. The same job then PASSED on the two following commits (`e3e7a92cd`, `87273b370`) with no fix in between, and passed on the last `main` run that executed it (`30468421532`). Signature matches the known AI round-trip nondeterminism family. Recorded rather than dismissed: this is NOT a same-commit success, so it does not strictly meet the "non-systematic" bar — re-open if it recurs.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one package, one capability. The cross-surface work (rename, shell handover, api feed) is deliberately deferred to its own lots and lanes.

## UAT Management (in orchestration context)
- **Mono-branch**: the list is not yet mounted in the app, so acceptance here is package-level (DOM/ARIA + unit). Owner UAT comes with the host wiring lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Sedimentation**
  - [x] Write `spec/SPEC_EVOL_AGENTS_SURFACE.md` (R1-R15, D1-D21, dependency declination, lots L-A..L-J).
  - [x] Round-1 self-review (Opus) folded in.
  - [x] Round-2 independent adversarial review (Codex `gpt-5.6-sol` xhigh) — verdict RECONSIDER, 11 findings reconciled.
  - [x] Record owner ratifications: breaking major GO, shell returned to the package, awaiting-input sorts first.

- [x] **Lot 1 — Entry contract**
  - [x] `AgentsEntry` union (`agent|session|remote|job|run`), status ladder, `AgentsFeedPort`.
  - [x] Status aggregation across the containment tree.
  - [x] Lot gate: `make test-chat-ui ENV=test-agents`, sabotage-verified (4/7 fail when urgency is inverted).

- [x] **Lot 2 — R9 ordering**
  - [x] Buckets, per-bucket recency key, hierarchical sort, malformed-feed tolerance.
  - [x] Lot gate: 15 tests; a `parentId` cycle bug was caught and fixed.

- [x] **Lot 3 — Last-consultation markers**
  - [x] Built over the existing async `ChatUiStorageAdapter`, principal+workspace namespaced, bounded, monotonic.
  - [x] Lot gate: 12 tests, sabotage-verified (3 fail).

- [x] **Lot 4 — Design-system wiring**
  - [x] Declare `CHAT-AGENTS-EX1` and add the DS to the DOM-test sandbox.
  - [x] Lot gate: 189 pre-existing DOM tests still green with the DS installed.

- [x] **Lot 5 — `AgentsList` component** (delegated to Codex `gpt-5.6-terra` xhigh)
  - [x] Built on `SelectableList`/`SelectableRow`/`StatusDot`/`Tag`/`Badge`/`Avatar`/`OverflowMenu`/`EmptyState` — no hand-written equivalent, no ad-hoc colour.
  - [x] `.svelte.d.ts` written; deliberately NOT re-exported from `src/index.ts` (that entrypoint stays DS-free).
  - [ ] Export subpath WITHHELD on purpose — see `CHAT-AGENTS-BLK2`.
  - [x] Lot gate: 7 DOM/ARIA tests running and green against REAL design-system components, fail-first proven twice.

- [x] **Lot 6 — Side-preference accessor**
  - [x] Additive public accessor on the placement menu, unblocking R11's repositionable column.
  - [x] Lot gate: unit test on read/write and full-mode behaviour.
