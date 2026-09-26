# Changelog

## 0.22.1

- Add GPT-6 Sol and Luna profiles, provider registrations and Codex routes;
  switch `claude-opus-5` → `gpt-6-sol`; `claude-sonnet-5`,
  `claude-sonnet-5-xhigh`, `claude-sonnet-4-6` → `gpt-6-luna` (effort preserved).
  `claude-opus-4-8` stays on `gpt-5.6-terra`.
- Conductor real calls on 2026-09-26 verified `gpt-6-sol` and `gpt-6-luna`
  with HTTP 200 on the direct OpenAI Responses API and working through Codex.
  Existing `gpt-6-astra` was also verified through ChatGPT-account Codex calls.
  Capabilities copied from gpt-5.6 (unverified);
  no context window / max output declared (unknown).
- Omit GPT-6 Terra: conductor real calls on 2026-09-26 returned HTTP 404 on
  the OpenAI API and HTTP 400 through Codex (ChatGPT account).
  Keep GPT-5.6 Terra routes and all GPT-5.6 catalog entries.
- Explicitly exclude the new models from benchmark council equivalence until
  evidence exists. Additive patch and target cutover; no public API change.

## 0.22.0

- Add the pure route quote API: `quoteRoute`, `RouteQuoteError`,
  `MAX_ROUTE_QUOTE_CANDIDATES` and the `RouteUsageCeiling`, `RouteQuoteInput`,
  `QuotedRouteCandidate`, `RouteQuote` contract types. A quote is synchronous,
  performs no I/O or clock read and never calls the account directory.
- `RoutePlanner` gains optional `quote(input)`; `InMemoryRoutePlanner` delegates
  with its council and policy profiles.
- `RoutePlanInput` gains optional `quote`; `plan()` keeps only quoted targets,
  caps attempts at the quoted maximum and throws `RoutePlanError` code
  `quote-mismatch` when the quote does not match. `RouteQuote.quotedAt` carries
  the quote instant; a pinned plan evaluates council freshness at it and
  ignores a sticky affinity to an unquoted target.
- Planning and quoting share one pure target resolution
  (`resolveRouteTargets` in `route-selection.ts`).
- Additive 0.x minor: no provider wire change.
