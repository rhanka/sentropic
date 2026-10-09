# Changelog

## 0.24.1

- Replace the exclusive `claude-opus-5-5` alias with standard multi-candidate
  routes for the `claude-opus-5-5` and `claude-sonnet-5-5` families
  (base/high/xhigh/max/medium/low): Muse contributor first, then Codex, then
  Cloud Code. Every launch alias now carries all three fallback transports,
  so any single enrolled transport serves any requested id.
- Codex slot policy: `gpt-6-astra` only for `claude-opus-5-5-max` and the
  `claude-fable-5-1` family, otherwise `gpt-6.1-sol` at +1 effort rung;
  the Muse candidate follows the same +1 rule. Serving choices grounded on
  Artificial Analysis Intelligence Index v4.3.2.
- Remove the exclusive-alias guards: owner-scoped overrides and council
  equivalents apply to every alias, stale affinities are served sticky
  without migration, and `no-route` is returned only when no candidate
  transport holds a usable account.
- GLM 5.3 supplemental fallback (owner decision 2026-10-08): the Claude 5.5
  families and the Fable 5.1 family gain the `zai-glm-5-3` candidate as the
  last fallback, mirroring the requested effort at +1 rung on the native
  low/high/max ladder (base/low/medium -> high, high/xhigh/max -> max);
  Opus 5 and Opus 4.8 keep the measured GLM-5.3 (Max) configuration.
- Patch release keeps the gateway `^0.24.0` and cluster-mesh
  `>=0.22.0 <0.25.0` dependency ranges (retargeted onto the 0.24.0 base).

## 0.22.3

- Add `gpt-6.1-sol` to the OpenAI catalog and provider registrations with a
  faithful Codex route. Existing GPT-6 Sol and Claude alias targets are preserved.
- Inherit GPT-6 Sol capabilities and task hints as unverified; no context window
  or output limit is claimed. Codex availability is unverified. Exclude the new
  model from benchmark equivalence.
- Patch release preserves the gateway and cluster-mesh 0.22.x dependency ranges.

## 0.22.2

- Add the exclusive `claude-opus-5-5` launch alias: every request routes to
  `openai / gpt-6-astra / codex` with no effort override and no Anthropic,
  Gemini or Muse candidate. Owner-scoped target overrides and council
  equivalents cannot replace it; per-request explicit restrictions still
  apply and may yield `no-route`.
- A stored non-Astra affinity follows an explicit `/model` switch to the
  alias: plan time treats it as absent and serves fresh Astra, a success
  rebinds it through the audited path, a failure or cancellation leaves it
  untouched. A compatible Astra affinity violating a per-request explicit
  restriction still yields `no-route`.
- The alias stays hidden from model inventory; `gpt-6-astra` remains listed
  when a ready account advertises it.

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
