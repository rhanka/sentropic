---
protocol: sentropic.h2a
version: "1.0"
kind: report
branch: feat/llm-model-update-runbook
head: 090ad60c396c0b827b0e7e1f833b46118721d7db
pull_request: https://github.com/rhanka/sentropic/pull/541
review_status: selection-failed
---

# BR-75 recurring LLM model-update report

## Outcome

Draft PR #541 delivers the recurring owner runbook, a dry-run-safe and
idempotent add-model scaffold, its focused tests, and the copy-ready drumbeat
and mesh-lane launch packet. The branch was pushed; the PR was not merged.

## Delivered surfaces

- `spec/SPEC_RUNBOOK_LLM_MODEL_UPDATE.md`: official-source anti-phantom gate,
  catalog/provider/routing/council workflow, full internal consumer audit,
  semver and mesh-before-gateway publication order, external host handoff, and
  current-tree file/line map.
- `make llm-mesh-add-model MODEL=<id> BASE=<id> [DRY_RUN=1]`: additive Make
  entrypoint under `BR75-EX1`.
- `packages/llm-mesh/scripts/add-model.mjs`: catalog, provider, and faithful
  default-route stubs copied from `BASE`; safe retry and no-write dry run.
- `packages/llm-mesh/tests/add-model-script.test.ts`: dry-run, valid-stub,
  idempotence, partial-repair, and invalid-input coverage.
- `docs/runbooks/model-update-launch-packet.md`: standard owner directive and
  lane mandate with Codex 5.6 Sol xhigh build and blind Opus 4.8 review gates.

## Evidence and validation

- Canonical reference: PR #540 / `origin/feat/llm-mesh-gemini-37`, now merged
  into base `origin/main` at `28d57d098`.
- Official OpenAI, Anthropic, and Google model registries returned HTTP 200.
- `make llm-mesh-add-model MODEL=gpt-5.7-sol BASE=gpt-5.6-sol DRY_RUN=1` passed
  without changing model sources.
- Model-council freshness check passed.
- `@sentropic/llm-mesh`: 147 tests passed; `@sentropic/llm-gateway`: 111 tests
  passed; scaffold suite: 3 tests passed.
- `make build`, `make typecheck`, and `make lint` passed with the isolated BR75
  ports and `REGISTRY=local`.
- Scope checks (`make scope-check` and `harness check scope`) passed.
- The local full `make test` passed smoke, unit, endpoint, queue, and security
  execution before reaching `api/tests/ai/**`. It then failed 18 AI tests with
  `Provider auth source is not configured`: all five provider keys are unset
  locally, while CI injects them explicitly. Runtime/auth paths are unchanged.
  CI run 31964219134 is the authoritative remote test gate.

## Open gates and source gaps

- Review status is `selection-failed`: this session attests the Codex host but
  not the exact author model or effort. The harness forbids inferred identity,
  so no independent blind-consensus claim was fabricated. PR review remains
  required.
- PR #540 is merged into the branch base; its 0.16.0 package and lockfile state
  is preserved as current-tree reference material.
- Vendor documentation is mutable; each future update must retain dated
  official model-id evidence in its own PR.
- h-cond/h2a-runtime host defaults, including agy, live outside this repo and
  remain a notification handoff.
- The current base contains stale consumer-version metadata in some lock and
  template surfaces; future model-update PRs must update or explicitly defer
  each audited consumer rather than copying those values blindly.

## Owner handoff

Review PR #541, require the remote CI result and an eligible blind reviewer,
then use the launch packet for the next model update. Do not merge from this
delivery lane.
