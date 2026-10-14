# Changelog

## Unreleased

- OpenAI Responses ingress (`POST /responses` + `POST /v1/responses`,
  stateless JSON/SSE): strict codec, lossless canonical mapping, native Codex
  execution (custom tools, `reasoning.context`, `text.verbosity`,
  `prompt_cache_key`, ordered reasoning items) and translated Muse/Mistral
  execution (named choice, parallel control, `max_tokens`, strict schemas,
  qualified tool-name return). Real-planner fixture replay pins every
  committed Codex body at 200 with usage preserved; committed Muse bodies
  are refused at 400 before dispatch (R5-MAJ-1: no proven Meta Chat
  reasoning slot).
- `mistral-vibe-cli-latest` alias resolving to the pinned
  `mistral:mistral-medium-3.5`/`mistral-vibe` target (no duplicate profile).
- Unknown-model 404 (BR-REL-Q3): plan-path, quote-path and terminal upstream
  `unsupported-model` failures map to Anthropic 404 `not_found_error` / OpenAI 404
  `invalid_request_error` (`model_not_found`) with the requested-model-only message
  `Unknown model: "<model>"`; no `Retry-After`, no `x-should-retry`. The terminal 404
  keeps `X-Sentropic-Served` with the actual model; plan/quote refusals carry none.
  Budget-quote refusals settle nothing; admitted-plan ledger failures preserve
  the typed refusal (attempted once, swallowed, original thrown).
- Known-model `no-route` without enrollment diagnostic is a non-retryable HTTP 503
  (BR-REL-Q7): Anthropic `api_error` / OpenAI `server_error` (`no_route`),
  `No route available for model: "<model>"`, `x-should-retry: false`, no `Retry-After`.
- `capabilities-unmet` plan/quote failures map to 400 `invalid_request_error`;
  `quote-mismatch` and unclassified errors stay on the sanitized 503.
- Terminal upstream refusals survive post-dispatch callback failures on both
  paths: a rejecting metering sink or `recordOutcome` hook no longer
  replaces the terminal `unknown-model` 404 (or any other terminal refusal)
  with a sanitized 503 `overloaded_error`. Settlement is attempted once and the
  terminal error wins, including admitted-ledger failures.
- Native Anthropic relay delivered INACTIVE (`LLM_GATEWAY_NATIVE_MESSAGES`
  must be exactly `enabled`; the qualified model list is empty and frozen):
  no caller-selected native transport exists in this release.
- Real `count_tokens` relay through the host `NativeCountTokensPort`
  (provider count verbatim on 200); counting errors never degrade the
  account (neutral lease outcome, account stays `active`).
- **Behavior change:** `safeguards` is refused with 400
  `invalid_request_error` in every configuration (OFF and ON): the qualified
  list is empty, so classifier auto-mode traffic carrying `safeguards` is
  rejected until a later qualification (owner ack pending).
- **Behavior change:** shared 32 000 000-byte body pool with fail-closed
  bounds (413/503 capacity refusals); concurrent large contexts may observe
  `capacity temporarily exhausted` (owner ack pending).
- **Behavior change:** named `tool_choice` / explicit
  `disable_parallel_tool_use` on Messages/Chat without a supporting
  transport is a 400 capacity refusal (was: silently served, control
  ignored) (owner ack pending).
- `GET /muse-code/models`: caller-filtered catalog shared with
  `GET /v1/models` (401 pre-pool), served on the product mount with the
  same caller admission as `/v1/*` and `/responses`.
- **Rupture:** `admitRoute` requires `subject` (budget admission). This
  required field justifies the minor bump.

## 0.19.0

- Add opt-in budget admission: `BudgetAdmissionPort` (`admit`, `markDispatched`,
  `release`) and the `budget` router option. Without it, the routed flow is unchanged.
- The gateway computes the route quote in-process (mesh `^0.22.0` `RoutePlanner.quote`)
  and pins the plan to it; a budget with a planner lacking `quote()` fails at construction
  with `BudgetConfigurationError`.
- Pre-acquisition refusals on both wires and both JSON/stream flows: over-budget uses the
  frozen 429 body with `Retry-After` bounded to 1-60 seconds; pricing/store failures use the
  sanitized 503 (new internal kind `budget-unavailable`); invalid ceilings return 400.
- `RouteRequestSettlement` gains optional `requestId`, `holdRef`, `quoteRef` and `overrun`;
  dispatched attempts without measured usage (missing, `{}`, partial, non-finite or zero
  counts) are charged at least their quoted allowance; a failed `release` never skips it.
- Budget path: the host `defaultOutputTokens` is sent as the request `maxOutputTokens`;
  attachments count as `imageUnits` and add `BUDGET_ATTACHMENT_INPUT_TOKENS` each to the
  input estimate (not an upper bound; the host adapter applies its own margin).
- Dependency floor: `@sentropic/llm-mesh` `^0.22.0`.
