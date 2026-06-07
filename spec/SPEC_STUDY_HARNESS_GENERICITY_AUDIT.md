# SPEC STUDY — Harness genericity audit (third-party, double-review)

Owner ask (2026-06-07): verify `@sentropic/harness` (PR #266, `d8e6d105f`) is a GENERIC
plugin (superpowers bar: installable in any repo) vs specific to the sentropic workflow,
and evaluate a first-class "audit/configuration" phase (`harness init` / `harness audit`)
that adapts the tool to the host repo (spec locations, command runner make vs nx, ...).

Reviewers (independent, adversarial, read-only): Codex 5.5 xhigh (`codex exec`) and
Opus 4.8 (subagent). Raw reports: conversation 2026-06-07. This spec is the synthesis.

## Verdicts

- Codex: **SPECIFIC** — small generic kernel, but package/CLI embed the sentropic method.
- Opus: **GENERIC-WITH-GAPS (library kernel) / SPECIFIC (plugin surface)** — kernel
  functions (`checkScope`/`checkBranch`/`classifyPath`/`toVerificationRun`) genuinely
  profile-driven; everything around them is sentropic-hardcoded.
- Net at the owner bar: **NOT generic today. The audit/configuration phase is mandatory**
  (mechanical enforcement requires materialized host conventions; superpowers escapes it
  only because its skills are prose).

## Convergent findings (both reviewers)

1. **BRANCH.md parser does not belong in the engine** (`src/branch-md/parse.ts`) —
   plan-file location + grammar is a host convention; it must become the sentropic
   profile's plan adapter. Opus: this is a drift from the articulation spec's own
   correction G (profile = rule-pack module, code + data).
2. **Engine-hardcoded sentropic grammar**: `BR\d+[a-z]?-EX\d+` extraction regex
   (parse.ts:26 — silently bypasses the profile's `exceptionIdPattern` at extraction:
   the stub profile's `EXC-\d+` exceptions are never extracted → SPI knob is dead),
   `**Allowed/Forbidden/Conditional Paths**` headings, `Plan / Todo`, `**Lot...**`.
3. **CLI closed profile set defaulting to sentropic** (`cli/run.ts:64`) — a foreign repo
   cannot reach the bin with its own profile; unknown `--profile` silently falls back to
   sentropic (defect: typo → wrong policy, no error).
4. **Scope model fixed to path globs** (`scope/scope-boundary.ts`) — nx tags/ownership
   graphs inexpressible without engine change.
5. **Missing SPI capabilities** (shared list): plan locator+parser injection, exception
   extraction hook, scope-grammar injection, command-runner descriptor
   (make|nx|npm|just|bazel + verb map), env data-lifecycle table (generalized C8),
   spec/plan layout, profile resolution/registration, config resolver.
6. **Config-phase design (convergent)**: repo-local config artifact + precedence
   `CLI flags > repo config > shipped profile defaults > engine defaults`;
   `harness init` = inspect → propose → generate, **enumerate-and-ask on ambiguity,
   never guess silently** (multi-runner monorepos; env lifecycle classification is asked,
   not inferred); `harness audit` = recurring validation of repo state vs configured
   profile, **emitting a neutral `VerificationRun`** (emit-only / track-optional seam
   preserved verbatim).
7. **Do not break current consumption**: pin the sentropic profile explicitly in the
   Makefile lane before changing any CLI default; no-config/no-flag behavior stays
   sentropic short-term.

## Divergences (and resolution)

- Verdict severity: Codex judges the plugin (SPECIFIC); Opus splits kernel vs plugin.
  Compatible; the actionable bar is the plugin surface.
- nx/tag scope adapters: Codex wants them in the main lot list; Opus defers until a real
  foreign consumer exists (YAGNI). **Resolution: defer (G5).**
- `C1`/`C2` violation codes: Codex would neutralize; Opus says renaming now breaks
  tests/skill for zero adoption gain — add neutral aliases at config time.
  **Resolution: aliases in G3, no rename.**

## Additional correctness findings (Opus, beyond genericity)

- **Exception binding is lax (correctness bug)**: one grammar-valid exception id ANYWHERE
  in the plan file (incl. prose/Feedback Loop) unlocks ALL conditional paths
  (`scope-check.ts:25,31`). MASTER.md semantics bind an exception to specific path(s) +
  rationale. **Must be fixed (per-path binding) before any blocking promotion of C2.**
- Glob deviation: `**/X` never matches root-level `X` (scope-boundary.ts:13-31) —
  document or fix with G1.
- Tolerant parsing hides misconfiguration: grammar mismatch → empty boundary → wall of
  `unknown` violations instead of "plan file didn't parse". Structural fix = `harness
  audit`; until then a foreign repo would misdiagnose FAIL-C2 noise as scope drift.
- README/profile genericity claim ("proven, not asserted") is overstated: the proof
  covers 3 data fields through the kernel; parser/extraction/CLI composition is
  unproven. Qualify the claim until the G2 composed test exists.

## Consolidated lot plan (additive; `make scope-check` + `validate-harness` stay green)

1. **G1 — plan-adapter SPI + parser relocation**: optional `plan` (locate+parse) on
   `HarnessProfile`; `parseBranchMd` moves into the sentropic profile (engine re-export
   for compat); CLI gains neutral `--plan-file` (keeps `--branch-md` as alias).
2. **G2 — exception extraction via profile** (delete engine regex) **+ per-path
   exception binding** (the correctness fix) **+ composed genericity test**
   (parser+profile with stub grammar) closing the proof hole; qualify the README claim.
3. **G3 — profile resolution + repo config**: open the closed set (flag > config >
   sentropic default); unknown `--profile` = hard error; config schema = data fields +
   command-runner descriptor + plan location; pin `--profile sentropic` in the Makefile
   lane FIRST; neutral violation-code aliases.
4. **G4 — `harness init` + `harness audit`** per the convergent design; audit emits
   `VerificationRun` (category `static`, codes `audit.*`); add `make harness-audit`.
5. **G5 (deferred, YAGNI)** — scope-matcher injection (nx tags) when a real foreign
   consumer exists.
6. **G6 (with the C8 branch)** — env data-lifecycle table as profile/config data; engine
   = generic operation-class × env-class gate only (owner directive 2026-06-07).
7. **(D7, owner-gated)** — un-`private` + publish/bootstrap when federation or a foreign
   consumer needs the installable plugin.

Sequencing constraint (both reviewers): G1/G2 BEFORE G3 — freezing a config schema
around the wrong seam is the main sequencing risk.

## Open decision (owner validation required — durable name)

- Config artifact name/home: proposal **`.harness/config.json`** (committed; `.harness/`
  also hosts generated audit reports). Alternative: `harness.config.json` at repo root.
  To validate before G3 lands (no-unvalidated-naming rule).

## Impact on PR #266

None blocking: the slice is correct for sentropic use; all lots are additive follow-ons.
Recommended before merge (1 docs commit): qualify the README genericity claim (see
correctness findings). The exception-binding fix (G2) is required only before C2's
blocking promotion, which is not in #266.
