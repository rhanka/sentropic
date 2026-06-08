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

> Status: **BR-42h** — published to npm (D7 lifted 2026-06-08). Installs like every other
> `@sentropic` CLI; `stp harness` subcommand federation is the scale lane (BR-42i).

## Install

```bash
npm i -g @sentropic/harness    # same as @sentropic/h2a, track, remote, …
```

## Use

```bash
# Right branch?
harness check branch --current-branch "$(git branch --show-current)" --expected-branch feat/x
# Changed files within the BRANCH.md declared scope?
harness check scope --branch-md BRANCH.md --staged-files "$(git diff --cached --name-only | paste -sd,)" [--json]
```

`--json` emits a neutral `VerificationRun`. `--profile sentropic|stub` selects the policy
pack (default `sentropic`). In an `@sentropic` repo, `make scope-check` wraps the staged+
unstaged scope check; agents (Claude/Codex/Gemini) are told to use harness — not a generic
verification skill — for branch/scope discipline (see `AGENTS.md`/`GEMINI.md`).

## This slice
`BRANCH.md` parser · `ScopeBoundary` · **C1** branch-check · **C2** scope-check (advisory,
BR25 **D5** Layer A) · neutral `VerificationRun`.

See `BRANCH.md` (branch root) for the lot plan and the design articulation specs
(`SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`, `SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md`).
