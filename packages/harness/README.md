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
  plugin-surface genericity (plan-adapter SPI and additional checks) is
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

`--json` emits a neutral artifact. Policy selection for `check`, `verify`, `audit` and `init`:
explicit `--profile sentropic|stub` > `--profile-file <path>` > repository-root
`harness.profile.json` > built-in `sentropic`. An explicit built-in ignores lower-priority files,
even if they are invalid. Unknown built-in names are errors. In an `@sentropic` repo,
`make scope-check` wraps the staged+unstaged scope check.

## Repository-owned profiles

Commit `harness.profile.json` at your Git root. Discovery walks upward to the nearest `.git`
directory or worktree file and checks only that root, including when invoked in a subdirectory.
Outside Git, the current directory is the root. `--profile-file` resolves relative to the current
directory; an absolute path also works. These files contain data only; no code is executed.

The published [JSON Schema](schema/harness-profile.schema.json) is also the runtime validation
contract. All objects reject unknown keys; fields are never coerced. Invalid configuration exits
with code **2**, including when `--json` is requested. Programmatic callers receive
`ProfileValidationError` with `code` and `path`; an unknown property has code `UNKNOWN_KEY`.
Other codes: `INVALID_PROFILE`, `INVALID_REGEX`, `PROFILE_READ`, `PROFILE_JSON`, `UNKNOWN_PROFILE`.
Unreadable or invalid selected files fail closed. Ordinary C1/C2 violations retain advisory exit 0.

A Rust + Node repository such as sentbase can start with:

```json
{
  "id": "sentbase",
  "forbiddenPathDefaults": ["Cargo.toml", ".githooks/**", "LICENSE"],
  "allowedPathDefaults": ["src/**", "web/**", "tests/**", "BRANCH.md"],
  "conditionalPathDefaults": ["Cargo.lock", "package.json", "package-lock.json"],
  "exceptionIdPattern": "^EXC-\\d+$",
  "conditionalRequiresException": true,
  "branchMatch": "exact",
  "branchMd": {
    "file": "BRANCH.md",
    "allowedHeading": "Allowed Paths",
    "forbiddenHeading": "Forbidden Paths",
    "conditionalHeading": "Conditional Paths",
    "planHeading": "Plan / Todo"
  },
  "commitMessage": {
    "requiredPattern": "^(feat|fix|docs|test|chore|refactor): .+",
    "forbiddenPatterns": ["Co-Authored-By:", "Claude-Session:", "Generated with"]
  }
}
```

```bash
harness check scope --staged-files src/lib.rs,web/index.ts
harness check scope --profile-file ./harness.profile.json --staged-files LICENSE
harness check scope --commit-message 'feat: add endpoint'
harness init --profile sentropic --json > harness.profile.json
```

| Field | Contract |
|---|---|
| `id` | Required nonempty profile identifier. |
| `forbiddenPathDefaults` | Required array of forbidden path globs; `[]` is valid. |
| `allowedPathDefaults`, `conditionalPathDefaults` | Optional default glob arrays; omitted means empty. |
| `exceptionIdPattern` | Required ECMAScript regex source for exception IDs, without `/` delimiters or flags. |
| `conditionalRequiresException` | Required boolean; when true, a declared matching exception permits conditional paths. |
| `branchMatch` | Required `exact` or `prefix` comparison for C1. |
| `branchMd` | Optional plan conventions; when present all five fields above are required. |
| `commitMessage` | Optional guards: required `forbiddenPatterns` array and optional `requiredPattern`, both regex sources. |
| `$schema` | Optional editor schema reference. |

Globs are repository-relative POSIX paths: `*` matches within one segment, `**` spans `/`,
and other characters are literal (no brace expansion, `?`, negation or implicit directory matching).
Empty paths, absolute paths, backslashes and `..` segments are rejected. Scope precedence is:
BRANCH allowed > BRANCH forbidden > BRANCH conditional > profile forbidden > profile conditional >
profile allowed > unknown. Thus an explicit branch grant can override a profile prohibition;
the example forbids `Cargo.toml`, `.githooks/**` and `LICENSE` by default.

Plans use `#` for the title, `##` for sections, bold bucket labels and backtick-quoted globs.
Bucket headings match case-insensitive prefixes, preserving parenthetical suffixes. `planHeading`
identifies the lot section; checkbox lots retain the `Lot` prefix. `exceptionIdPattern` also drives
exception extraction from plan text. Without `branchMd`, canonical headings apply and a plan is
read only via `--branch-md`. With `branchMd`, its `file` is relative to the Git root and is read
when present; `--branch-md` overrides it and is relative to the current directory. Missing explicit
plans are errors. Missing default plans leave the profile defaults in effect.

Commit guards run only when `--commit-message <text>` is supplied to scope, verify or audit.
Regexes inspect the entire message, including trailers, case-sensitively and without flags.
Built-in profiles have no commit guards. Both built-ins are valid schema documents, available via
`harness init --profile sentropic|stub --json`; loading those documents preserves their C1/C2 results.

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
