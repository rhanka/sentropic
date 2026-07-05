---
name: adopt
description: Use when bringing the harness method to a NEW or non-sentropic repo — maps the repo's conventions into a harness profile so the same scope/branch/verify kernel applies anywhere.
---

# harness/adopt

Native repo-onboarding. The harness engine (parser, C1/C2 checks, verify) is generic; all repo-specific
policy is DATA in a profile. `adopt` maps a foreign repo onto that SPI so the method runs unchanged.

## Steps

1. **Scaffold** — `harness init [--profile sentropic|stub] [--json]` prints a profile descriptor. Save it
   as `harness.profile.json` at the repo root and edit it to fit:
   - `forbiddenPathDefaults` — globs forbidden unless a BRANCH.md explicitly Allows them.
   - `exceptionIdPattern` — the grammar of a valid scope-exception id (e.g. `^BR\d+-EX\d+$`).
   - `conditionalRequiresException` — whether a Conditional path needs a matching declared exception.
   - `branchMatch` — `exact` or `prefix` for the C1 branch check.
2. **Map the repo's reality** — translate the repo's conventions, not sentropic's: which paths are
   off-limits, what its BRANCH.md grammar is (or whether one must be introduced), the command runner
   (`make` vs `npm`/`nx`), and the environment data-lifecycle (which envs are disposable vs protected).
3. **Audit** — `harness audit --staged-files "<changed files>" --branch-md <path> --json` diffs the repo
   against the active profile and emits a `VerificationRun (static)` listing drift: forbidden touches,
   undeclared (unknown) paths, missing scope declaration.
4. **Wire** — add a `scope-check`/`verify` step to the repo's pre-commit or CI using the profile, so the
   method is enforced, not just documented.

## Principle

A second `stub` profile diverging from `sentropic` on a checked dimension is the proof-of-genericity:
the same kernel yields different, correct verdicts per profile. Adoption succeeds when a third repo can
declare its OWN profile and the unchanged engine governs it.
