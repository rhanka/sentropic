# Changelog

## Unreleased

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
