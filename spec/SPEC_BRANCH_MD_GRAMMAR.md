# SPEC — Shared `BRANCH.md` grammar (one contract for `harness` and `track`)

Status: **PROPOSAL 2026-06-09** (BR-42h pre-UAT follow-on; flagged by both reviewers of the
scope-ownership decision — see `spec/SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md`).

## Why

`BRANCH.md` is the single human source of truth for a branch's scope (path globs), lots/items,
and exceptions. **Two tools parse it independently:**
- `@sentropic/harness` extracts the **path globs** (Allowed/Forbidden/Conditional) + lot
  checkboxes (`packages/harness/src/branch-md/parse.ts`).
- `@sentropic/track` imports it into `.track/events.jsonl` and derives **lot/item realization**.

Each has its OWN parser keyed on exact markdown shapes. That is a **latent double-source-of-truth**:
a template drift silently empties one side. This is not theoretical — harness 0.1.0 shipped with a
parser that required the heading to be exactly `**Allowed Paths**`, but the canonical template
writes `**Allowed Paths (implementation scope)**`, so **every real BRANCH.md parsed to empty
allowed/forbidden** and in-scope files were flagged `unknown` (advisory C2 hid it). Fixed in
harness 0.1.1 by prefix-matching. The fix is correct but proves the risk: **two parsers, one
undocumented format, no shared conformance**.

## Goal

One **canonical grammar definition** + one **golden fixture** that BOTH tools test against in CI,
so neither can drift from `plan/BRANCH_TEMPLATE.md` without a failing conformance test.

## Canonical grammar (normative; derived from `plan/BRANCH_TEMPLATE.md`)

- **Title**: first single-`#` heading; a leading `Feature:` is stripped.
- **Scope buckets**: bullet headings matched by **PREFIX**, case-insensitive, tolerating a
  parenthetical suffix:
  - `- **Allowed Paths …**:`   (matcher: `/\*\*Allowed Paths/i`)
  - `- **Forbidden Paths …**:` (matcher: `/\*\*Forbidden Paths/i`)
  - `- **Conditional Paths …**:` (matcher: `/\*\*Conditional Paths/i`)
  Globs are **backtick-quoted** tokens on the heading line and/or on subsequent indented
  `- \`glob\`` list items, until the next bucket heading or a non-indented bullet.
- **Exceptions**: tokens matching the profile's exception grammar (sentropic default
  `BRxx-EXn`, i.e. `/\bBR\d+[a-z]?-EX\d+\b/`); anywhere, but SHOULD live in `## Feedback Loop`.
- **Plan/lots**: a `## … Plan / Todo …` section; lots = `- [ ] **Lot N — …**` (checkbox +
  bold lot title); items = indented `- [ ] …` under a lot.
- **Tolerant**: malformed input yields empty fields, never throws — BUT see "conformance" (a
  silently-empty parse on a well-formed template is a BUG, caught by the fixture).

> The heading PREFIX rule is the load-bearing correction: the closing `**` is NOT adjacent to
> the bucket word in the real template. Any parser keying on `**Allowed Paths**` (closing `**`
> required) is non-conformant.

## Deliverables

1. **`spec/fixtures/branch-md/canonical.BRANCH.md`** — one canonical `BRANCH.md` exercising
   every grammar element (suffixed headings, multi-line globs, conditional+exception, lots+items).
2. **`spec/fixtures/branch-md/canonical.expected.json`** — the expected parse (title,
   allowedPaths, forbiddenPaths, conditionalPaths, exceptions, lots[].items[]).
3. **Conformance test per tool** consuming the SAME fixture:
   - harness: a vitest asserting `parseBranchMd(fixture)` equals the expected JSON.
   - track: an equivalent assertion on its importer's derived items/scope.
   Each tool keeps its own parser (different outputs — harness: globs+lots; track: items), but
   both validate against the one fixture for the SHARED elements (title, lots, exceptions, and
   — where track also reads them — the path buckets).
4. **MASTER.md note**: `BRANCH.md` MUST follow `plan/BRANCH_TEMPLATE.md`; the grammar is
   normative here; both tools are derivations; BRANCH.md is authoritative.

## Ownership / sequencing

- This spec + fixtures are **tool-neutral** (live in `spec/`), owned jointly.
- harness adds its conformance test now (G-series follow-on; its parser already conforms post-0.1.1).
- track adds its conformance test when it wires scope-state (coordinated via the scope-ownership
  decision; track owner notified). Until then the spec stands as the contract.
- Long term, a tiny shared parser module is OPTIONAL (only if the two parsers' shared-element
  logic genuinely converges); the **fixture-based conformance is the minimum that prevents drift**
  and is enough.

## References
- `spec/SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md` (the decision that flagged this).
- `packages/harness/src/branch-md/parse.ts` (the conforming parser, post-0.1.1).
- `plan/BRANCH_TEMPLATE.md` (the human-facing template the grammar mirrors).
