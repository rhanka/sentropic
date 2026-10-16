# Changelog

## 0.26.1

- CI seat envelope `SeatBundleV1` for the five CLI seats (agy, codex, vibe,
  muse, claude): frozen identity with issuing client and endpoint family,
  channel-granted authority validation, native-store references and refresh-less
  consumer projections, exported from `@sentropic/llm-mesh/node` only.
  Synthetic fixtures and validators; native profiles stay unverified.

## Unreleased

- Responses execution features: per-transport support table
  (`reasoning-context`, `custom-tools`, `verbosity` on Codex;
  `named-tool-choice`, `parallel-tool-control`, `explicit-output-ceiling`,
  `strict-schema` on Muse — no `reasoning-controls` (R5-MAJ-1: no proven
  Meta Chat reasoning slot, reasoning requests fail closed);
  `strict-schema` on Mistral Vibe) with fail-closed planning/quoting
  eligibility, plus the native Responses carrier (`customTools`,
  `functionToolRefs`, reasoning artifacts, context, verbosity, cache hints)
  projected by the Codex adapter and bare→qualified tool-name requalification
  on all three Responses adapters.
- `mistral-vibe-cli-latest` alias resolving to the pinned
  `mistral:mistral-medium-3.5`/`mistral-vibe` target (no duplicate profile).
- Muse Wonder (`muse-wonder-1.0`) + Wonder Full (`muse-wonder-full-1.0`)
  catalog entries, `muse`/`muse` routing targets and council listing
  (owner request 2026-10-13, Full id corrected 2026-10-14); same
  transport-keyed Responses execution set as Spark (minus
  `reasoning-controls`, R5-MAJ-1), gateway default unchanged.
- Gemini 4 Argon (`gemini-4-argon`) catalog entry, `gemini`/`cloud-code`
  routing target and council listing (owner request 2026-10-14); same
  `gemini-3.8-flash` pattern (`gemini-4-argon-low|medium|high` resolve per
  effort through the generic Cloud Code wire suffix, no transport change).
- Argon/Wonder serving table (owner request 2026-10-15, Artificial Analysis
  Intelligence Index read 2026-10-15): the cloud slot serves `gemini-4-argon`
  at high effort for Opus 5.5 (base/medium/high/xhigh/max), Sonnet 5.5
  (high/xhigh/max) and every Fable 5.1 row (Opus 5.5 low + Sonnet 5.5 medium
  keep 3.8 Flash high, Sonnet 5.5 low moves to 3.8 Flash medium); the muse
  slot serves `muse-wonder-full-1.0` on Opus 5-5 max/xhigh + Sonnet 5-5 max,
  `muse-wonder-1.0` on Opus 5-5 base/medium/high + Sonnet 5-5 xhigh + every
  Fable 5.1 row, Spark kept elsewhere. Muse efforts and the named-400
  capability rule unchanged.
- **Rupture:** `admitRoute` requires `subject` (budget admission). This
  required field justifies the minor bump.
- Codex device-flow network tolerance: poll + token-exchange retry (3
  retries, linear backoff); exhaustion carries cause + URL, never bare
  `fetch failed`.
- 503 diagnostics in body: per-transport causes on no-route, subsystem
  naming (`authentication` / `account` / `budget service temporarily
  unavailable`), expiry timestamp + repair action on reauth-required.

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
