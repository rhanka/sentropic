# Changelog

## Unreleased

### 0.20.0 native Anthropic relay

- Messages, Chat Completions and count_tokens share a process-wide default
  32,000,000-byte in-flight body pool and a 32,000,000-byte per-request ingress
  cap, including when native is disabled. Concurrent small bodies reserve their
  actual chunks, not a full cap per request; no request semaphore or queue.
  Check size, grant bytes, then allocate exact chunk backing storage.
  Content-Length never sizes storage, reservations or measured bytes; parse once
  at EOF without duplicate raw consolidation or a Request clone.
- Leases follow retained references: native hosts must finish/cancel uploads and
  detach request/serialized holders before returning a commit-ready stream or
  completed JSON/count. Gateway detaches its cache/body/retry holders before
  shrinking to zero; an open native stream can admit more small requests.
  Canonical streams keep measured N until terminal cleanup/SDK retries settle.
  Completion, abort, errors, unconsumed streams and every post-acquisition refusal
  clear holders and release once, independently of observation-hook completion.
- Unavailable chunk capacity returns retryable 503 `request-body-capacity`,
  `Retry-After: 1`, `x-should-retry: true`, before parse/admission/dispatch.
  Oversize received bytes take precedence and return terminal 413:
  Anthropic `request_too_large`, OpenAI `invalid_request_error` /
  `request_too_large`. Typed upstream 413 is preserved without overload/retry
  remapping; numeric messages distinguish exact N, received lower bounds and
  unknown upstream limits, never trusting Content-Length or provider prose.
- Native usage counts physical U+R+aggregate writes once, with sourced pricing:
  uncached input at full rate, reads 0.1x (Sonnet 5/Opus 5), 0.025x (Fable 5.1),
  five-minute writes 1.25x and one-hour writes 2x, represented in bounded integer
  units40.
  Start-anchored deltas inherit absent/null categories and unchanged TTL splits;
  aggregate growth alone costs 1.25x when default TTL is eligible, otherwise only
  the growth costs 2x with separate inference evidence, compatible with measured
  clean completion. Decreases/conflicts/malformed input permanently revoke proof.
- Clean measured native usage retains actual final output without an allowance
  floor. Interrupted streams with usable same-model input proof preserve latest
  accepted input and floor output only. Missing/revoked proof restores input and
  output allowance floors; mismatch, fallback or substantive/malformed iterations
  disables discounted pricing and uses full physical input rate. Missing/null/[]
  iterations are absent. Observation snapshots stay physical and pre-floor;
  successful latched turns can still charge 32,000 output against 500 observed
  (64x output), with selected-price/feature-cost uncertainty retained. Host pinned
  cache pricing, audit persistence and live qualification remain integration gates.

- Anthropic Messages with own top-level `safeguards` requires native execution;
  `anthropic-beta` presence makes native optional, including empty/unknown values.
  Version-only Messages stays canonical. Optional fallback is pre-dispatch only;
  native invocation never falls back to canonical reconstruction.
- Trusted `nativeMessagesEnabled: false` refuses safeguards before model lookup
  with 400 `invalid_request_error` naming `safeguards`. Standalone routers without
  native capability also refuse safeguards instead of silently dropping it.
- Native bodies preserve unknown fields and nested references; only selected
  `model`, boolean `stream` and the validated/admitted `max_tokens` are overwritten.
  Caller headers forward only non-credential/non-hop-by-hop `anthropic-*`,
  `x-app` and `x-stainless-*`; caller user-agent, sessions and internal headers drop.
- Native success extends canonical safe response headers with `anthropic-*`,
  including owner-accepted `anthropic-organization-id` disclosure (R-Q3).
  Credential/session, Connection-nominated and upstream `X-Sentropic-*` headers
  remain excluded; errors never copy upstream headers.
- Native validation 400s retain recognized type/message after control stripping
  and a 4096-byte UTF-8 cap, within a 64 KiB error-body bound. Shared-organization
  billing-state text is masked with fixed text; only the sent classifier-beta
  refusal receives the narrow safeguards rewrite. Canonical errors stay sanitized.
- Successful native JSON/SSE sets `X-Sentropic-Relay: native`. JSON
  `X-Sentropic-Served` uses only a safe response model with no fallback/substantive
  iterations; absent/invalid identity is omitted. Native SSE omits that header.
  Success JSON is semantically unchanged and SSE success frames remain byte-exact.
- Add authenticated JSON-only `POST /v1/messages/count_tokens`: enabled only by
  trusted `nativeMessagesEnabled: true` and an eligible exact-model count port,
  even without beta/safeguards. OFF/known-denied returns 400, catalog-unknown 404.
  It shallow-copies the body without edits, returns safe integer `input_tokens`,
  never plans generation, holds funds, settles or finalizes usage observations.
  The shared per-process limiter allows ten burst tokens, refills one per second,
  limits two live calls per tenant/principal, evicts idle keys after ten minutes
  and caps the map at 10,000 keys. Dispatch consumes a token without cancel refund;
  excess returns 429, a new key at full capacity 503; there is no automatic retry.

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
