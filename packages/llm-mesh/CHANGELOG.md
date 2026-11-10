# Changelog

## Unreleased

## 0.34.1

- Patch on the 0.34 line (consumer ranges `llm-gateway ^0.34.0`, cluster-mesh `<0.35.0` admit 0.34.x): concrete Node Claude seat host (`@sentropic/llm-mesh/node`).
- `NodeClaudeCodeCliRunner` spawns the `claude` CLI headless (`-p --verbose --output-format stream-json`, `--model`, `--effort`, optional `--system-prompt-file`; `--verbose` is required with stream-json on the 2.1 line), feeds the projected prompt over stdin, and normalizes stream-json output to `ClaudeCodeCliEvent`. The seat OAuth access projection travels as `CLAUDE_CODE_OAUTH_TOKEN` in the child env only (never argv); the child env is an allowlist (PATH plus locale/timezone knobs) with auth/endpoint/cloud carriers purged, so ambient key auth can neither override the seat grant nor leak to the CLI. Confinement: `--tools ""`, `--strict-mcp-config` with no `--mcp-config`, `--no-session-persistence`, and a fresh sandbox directory as cwd, HOME and `CLAUDE_CONFIG_DIR`; a non-empty tool/MCP inventory in the CLI init line fails the run closed immediately with no further event emitted, a successful run always observed an `init` line, and requests carrying tool definitions are refused before spawning. Timeouts and aborts escalate from a group SIGTERM to a group SIGKILL with pipe teardown and close await; stdout is line/total capped and stderr byte-capped. The probe spawns detached with close-drained output and pins the `stream-json` value plus the `-p` headless switch. Quota signals (5-hour session limit, rate limits, overload, matched on CLI-owned message fields only) surface as the typed `ClaudeCliQuotaError` (status 429, retryable `rate_limit`); every other host failure is a fixed-message runner error carrying no CLI output.
- `ClaudeCodeRuntimeClient` passes quota signals through as a fresh typed `claude_cli_rate_limited` failure (numeric fields only, secret boundary intact), so `AnthropicAdapter.normalizeError` yields a retryable `rate_limit` for the consumer quota circuit.
- Factory `createClaudeSeatAnthropicClient` plus `probeClaudeCodeCliCapabilities` (`claude --version` minimum 2.1 plus `claude --help` confinement-flag check, both with a token-free allowlist env) for consumers building `clients.anthropic`; `./node` also re-exports `ClaudeCliQuotaError` for consumer `instanceof` handling.
## 0.34.0

- Custodian Lot 1 (new surface, minor): proactive refresh cycle
  (`runCustodianRefreshCycle`) over mesh-managed accounts inside the skew
  window (25 percent of credential TTL remaining from issuance, 10 min
  floor, injected clock), per-account secret-free custody-state report.
  Definitive refresh failures flip `reauth_required` early and emit a
  secret-free `ReauthAlertSink` event (diagnostic account ref only, once per
  epoch). Only provably unconsumed failures defer without flipping
  (explicit 429/5xx token-endpoint responses, typed local preparation
  failures); timeouts, resets, mint/persistence failures after a possible
  grant rotation (typed `MusePostRotationError`), and unknown shapes flip
  fail-closed so a consumed grant is never replayed. `startCustodianLoop` /
  `stopCustodianLoop` run the hosted loop (immediate first cycle, jittered
  cadence, `onError` surface, exactly one loop per owner scope); the
  custodian controls live on the administrative facade. External seats stay
  skipped (an expired or unknown-expiry one reads reauth-required without
  flipping); grant-less credentials warn once inside the window
  (`expiring-no-grant`, upcoming expiry exposed in the report) and flip on
  expiry for a planned re-enrollment. A CLI-imported Muse credential carries
  no refresh grant yet refreshes through the cycle (CLI store re-read),
  unlike direct-billed Muse keys (`auth_type: 'api_key'`).

## 0.33.0

- Seat onboarding (design r3, lots L1–L5): the `SeatOnboardingV1` contract
  and fail-closed validators, the agy canonicalizer and node-side capture,
  two-stage materialization (`materialiseSeatEnvelopes`,
  `materialiseCellHome`) with launch-gate derivation and `eraseSeatHome`,
  the claude/muse/codex projections with the Q2-limited trust write, and the
  L5 stored seat record: `importSeatBundle` accepts an optional `onboarding`
  block (validated and bound before any registration), persists a versioned
  seat record per seat account, backfills it on idempotent reimport, and
  deletes it on removal; the facade gains `exportSeatBundle`, which returns
  the stored bundle and block verbatim and refuses with typed
  `seat-export-unavailable:<reason>` (`not-a-seat`, `record-missing`,
  `lineage-mismatch`, `owner-mismatch`, `record-invalid`).

## 0.32.4

- `EncryptedFileKeyring` reads are now side-effect free: `getSecret` (the
  `listAccounts` → `restorePersistedAccounts` → keyring read chain) no longer
  runs `mkdir`/`chmod`, so reads work on read-only mounts (seat export) without
  EROFS and no longer bump the keyring directory ctime on every read.
- A read requires the keyring directory to be `0700` and the master key
  `0600`. Wrong modes refuse with the typed `keyring_insecure_permissions`
  error (`KeyringInsecurePermissionsError`, exported from
  `@sentropic/llm-mesh/node`) and are never repaired silently. A missing
  directory or master key on a read keeps the existing not-found behaviour and
  creates nothing.
- The write path still creates the keyring and master key, and now sets modes
  only when they differ.

## 0.28.0

- Add `@sentropic/llm-mesh/speech` and root exports for the provider-neutral
  live speech contract, binary frames, partial revisions and duplex ports.
- An independent `SpeechEngineCatalogue` lists every model revision, adapter
  and placement, including STT/TTS engines outside the LLM model catalogue.
  `getModelSpeechCapabilities(providerId, modelId, catalogue?)` returns all
  qualified tuples; an empty array means unqualified. Provider and chat model
  capabilities do not inherit speech claims.
- Negotiate languages, voices and regions through supported sets. Account and
  resource references remain opaque session selectors for gateway admission.
- Migration: `ModalityCapabilities.output` now includes `audio`; consumers
  with exhaustive output-modality switches must handle it. Existing text
  models keep their output modalities and routing unchanged.

## 0.27.0 candidate

- Exact provider/model identity is now the default for canonical resolution,
  quotes and planning. A Claude request cannot silently become an Argon,
  Muse or Codex request. Identity aliases such as the Vibe wire name remain.
- Migration: trusted low-level callers that intentionally use the existing
  equivalence tables must select `allowEquivalentModels: true` explicitly.
  Durable gateway sessions instead commit a frozen `LaunchRoutingContract`
  with mapping ID/revision/content digest, model grants, authorized accounts,
  independent rotation consent and preserved effort. Old sessions do not
  inherit this consent. Conflicting overrides refuse.
- The `RouteAffinityStore` port acknowledges first pins and account epochs
  durably before output. Restart and memory eviction reload protected pins;
  missing/deleted pins refuse. A sticky account never authorizes an obsolete
  model. Same-model account rotation records cache-continuity risk.
- Muse Chat now also rejects unproved reasoning controls on direct adapter
  calls, before network I/O. No native Responses transport or CLI qualification
  is claimed by this candidate.

## 0.26.1

- CI seat envelope `SeatBundleV1` for the five CLI seats (agy, codex, vibe,
  muse, claude): frozen identity with issuing client and endpoint family,
  channel-granted authority validation, native-store references and refresh-less
  consumer projections, exported from `@sentropic/llm-mesh/node` only.
  Synthetic fixtures and validators; native profiles stay unverified.

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
