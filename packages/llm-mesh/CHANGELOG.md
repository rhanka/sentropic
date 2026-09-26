# Changelog

## 0.22.1

- Add GPT-6 Sol and Luna profiles, provider registrations and Codex routes;
  switch standard Sol/Luna routing targets to GPT-6, preserving effort tiers.
- Conductor verified `gpt-6-sol`, `gpt-6-luna` and existing `gpt-6-astra`
  using real ChatGPT-account Codex calls on 2026-09-26. Direct API availability
  and inherited 5.6 capabilities remain unverified; no new limits are claimed.
- Omit GPT-6 Terra: Codex rejected it with HTTP 400; API availability is
  unverified. Keep GPT-5.6 Terra routes and all GPT-5.6 catalog entries.
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
