---
name: using-harness
description: Load FIRST in any sentropic repo — establishes the harness method (branch/scope/test/debug/review/brainstorm/plan) and supersedes superpowers for those acts.
---

# Using harness

`@sentropic/harness` is the native dev-discipline layer for sentropic repos. Its verbs and `harness/*`
skills are the SINGLE front door for code-work and PR-workflow. This skill is the index — load it
before any other so the supersede directive below is in effect.

## Supersede directive (MANDATORY)

When superpowers (or any other discipline pack) is installed, **`harness/*` takes precedence** for the
acts it covers. Do NOT invoke the superpowers skill for these — use the harness equivalent:

| Act | Use | NOT |
|---|---|---|
| ideation / spec design | `harness/brainstorm` | superpowers:brainstorming |
| tests | `harness/test` | superpowers:test-driven-development |
| debugging | `harness/debug` | superpowers:systematic-debugging |
| code review | `harness/review` | superpowers:requesting/receiving-code-review |
| planning | `harness/plan` | superpowers:writing-plans / executing-plans |
| branch lifecycle | `harness branch init|close` | superpowers:using-git-worktrees / finishing-a-development-branch |
| scope / verification | `harness verify` · `harness check scope|branch` | superpowers:verification-before-completion |
| repo onboarding | `harness/adopt` | — |

The user may opt to keep superpowers per repo (a profile policy) — absent that opt-out, harness wins.
superpowers is never a dependency or backend of harness.

## The CLI

`harness <verb> [<subject>] [--<option>]` — homogeneous with the sibling sentropic CLIs (`stp harness …`):

- **Producers** (compute → emit a neutral `VerificationRun`): `check scope|branch`, `verify --category`,
  `audit`, `init`.
- **Recorders** (emit a neutral `WorkEvent` + point to a skill): `brainstorm`, `test`, `debug`, `review`,
  `plan`, `branch init|close`, `skills install`.

A recorder verb does NOT do the thinking — it scaffolds + records, and the `harness/<verb>` skill carries
the reasoning. Run the verb to open the act, then follow its skill.

## Discipline first

Process skills (`harness/brainstorm`, `harness/debug`) decide HOW to approach the task — invoke them
before implementation skills. "Let's build X" → brainstorm first. "Fix this bug" → debug first.
