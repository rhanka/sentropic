# @sentropic/harness

Neutral, host-agnostic **code-work / PR-workflow** tooling for AI-driven development:
branch / scope / lot / verify discipline, behind a pluggable **profile** SPI.

- **Tooling-only**: zero product-runtime coupling (no Drizzle / Hono / Svelte / Mistral),
  zero `@sentropic/*` deps. Node built-ins + TypeScript only.
- **Emit-only**: checks produce a neutral `VerificationRun` artifact; harness never writes
  into `@sentropic/track` (a track-side adapter ingests the artifact).
- **Policy as data**: the Sentropic rules (scope paths, exception grammar, thresholds) live
  in a `sentropic` profile module behind the `HarnessProfile` interface — the engine is
  generic (proven by a second `stub` profile).

> Status: **BR-42h core slice** — `private` while built in-repo. Public npm publish +
> `stp harness` subcommand registration are deferred per BR25 **D7**.

## This slice
`BRANCH.md` parser · `ScopeBoundary` · **C1** branch-check · **C2** scope-check (advisory,
BR25 **D5** Layer A) · neutral `VerificationRun`.

See `BRANCH.md` (branch root) for the lot plan and the design articulation specs
(`SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`, `SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md`).
