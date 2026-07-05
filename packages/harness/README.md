# @sentropic/harness

Neutral, host-agnostic **code-work / PR-workflow** tooling for AI-driven development: a homogeneous
`harness <verb>` method layer (branch · scope · verify · test · debug · review · brainstorm · plan)
behind a pluggable **profile** SPI. The NATIVE sentropic replacement for superpowers.

- **Tooling-only**: zero product-runtime coupling (no Drizzle / Hono / Svelte / Mistral),
  zero `@sentropic/*` deps. Node built-ins + TypeScript only.
- **Emit-only**: checks produce a neutral `VerificationRun` artifact; harness never writes
  into `@sentropic/track` (a track-side adapter ingests the artifact).
- **Policy as data**: the Sentropic rules (scope paths, exception grammar, thresholds) live
  in a `sentropic` profile module behind the `HarnessProfile` interface. The check **kernel**
  is profile-driven (a second `stub` profile exercises it with divergent policy); full
  plugin-surface genericity (plan-adapter SPI, profile resolution, `harness init`/`audit`) is
  the G1–G4 follow-on tracked in `SPEC_STUDY_HARNESS_GENERICITY_AUDIT.md`.

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

`--json` emits a neutral artifact. `--profile sentropic|stub` selects the policy pack (default
`sentropic`). In an `@sentropic` repo, `make scope-check` wraps the staged+unstaged scope check.

## Verbs

`harness <verb> [<subject>] [--<option>]`, homogeneous with the sibling CLIs (`stp harness <verb>`):

| Verb | Kind | Emits | Reasoning |
|---|---|---|---|
| `check scope\|branch` | producer | `VerificationRun` | — |
| `verify --category <c>` | producer | `VerificationRun` (roll-up) | — |
| `init` / `audit` | producer | profile descriptor / `VerificationRun` | skill `harness/adopt` |
| `brainstorm [--peers] [--ladder]` | recorder | `WorkEvent` | skill `harness/brainstorm` |
| `test [--category]` | recorder | `WorkEvent` | skill `harness/test` |
| `debug` | recorder | `WorkEvent` | skill `harness/debug` |
| `review --consensus [--peers]` | recorder | `WorkEvent` | skill `harness/review` |
| `plan [--lots]` | recorder | `WorkEvent` | skill `harness/plan` |
| `branch init\|close` | recorder | `WorkEvent` | — |
| `skills install --host <h>` | recorder | `WorkEvent` | installs the pack |

**Producers** compute a pass/fail verdict; **recorders** scaffold + record a narrative `WorkEvent` and
point to a `harness/*` skill that carries the LLM reasoning (the binary never does the thinking).

## Skill pack (superpowers replacement)

`harness skills install --host claude|codex|gemini` installs `harness/{using-harness,brainstorm,test,
debug,review,plan,adopt}`. `harness/using-harness` loads first and **supersedes** the superpowers skills
for those acts. superpowers is never a dependency; the user may opt to keep it per repo.

See `BRANCH.md` (branch root) for the lot plan and the design specs
(`SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md`, `SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`).
