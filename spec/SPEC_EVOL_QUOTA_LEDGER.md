# SPEC_EVOL — ARCH-13: Quota / Cost Ledger + Abuse Posture

> Wave-1 architecture study (ARCH-13, SPEC_EVOL_ARCHITECTURE.md:718). Grounded in code-reality, then hardened by **double consensus (Codex 5.5-xhigh + Fable 5, both GO-WITH-CHANGES, 2026-06-11)** — they found a real budget-bypass flaw in the v0 write-path; all convergent must-fixes folded. Doc-only. The **anonymous-budget ownership** sub-decision (arch:668) is OWNER-ONLY → §6 batch.

## 0. Frame & ground truth (corrected)
- **D6=B** (arch:667): internal Postgres cost/quota ledger wiring `CostContext`, per-model caps + anonymous circuit-breaker + bot posture; billing later. **D3=A** (arch:664): guests = rows in `users`. **Control-namespace** (data:168-176): control schema, own migration stream, NO cross-namespace FK, DD9 isolation, CHECK discipline, append-only + ARCH-15 erasure (first control-plane proof, arch:354).
- **Code reality (2026-06-11)**:
  - `CostContext` (contracts/src/index.ts:22-27) DEFINED but UNWIRED.
  - **Provider `usage` is DISCARDED on EVERY streaming path** (`done` yields `{data:{}}` at llm-runtime/index.ts:1363/1508/1700/1878/2187 — `grep usage` over the 2208-line file finds zero stream-side handling) and **nulled on 4/5 non-stream providers** (:978/1031/1085/1139; only OpenAI chat-completions passthrough keeps it). The `step-finish` StreamEvent with `usage`+`costDeltaUsd` (events/src/index.ts:33-38) exists for this and is UNCONSUMED. → **A normalized usage/cost envelope at the LLM boundary is a NAMED PREREQUISITE, not an integration detail.**
  - No quota/budget/cost/ledger tables; model catalog (llm-mesh/catalog.ts:244-354) has NO pricing; rate-limit is auth-only (app.ts:117-191); no cost kill-switch (only token-scoped `context-budget` zones).
  - Deploy topology (confirmed): **SCW LoadBalancer → cluster Traefik (configured in poc-k8s repo) → UI-pod nginx → API** (main app); IdP = direct Traefik. **`ui/nginx/default.conf` does NOT forward `X-Forwarded-For` to the API**; `api/src/app.ts` has NO trusted-proxy config; XFF is taken as-is (spoofable); `userSessions.ipAddress` raw, no `ipHash`.
  - `resolveProviderCredential({requestCredential,userId,workspaceId})` resolves user/workspace BYO provider keys.

## 1. Question set
Q1 schema · Q2 CostContext filling + write-path · Q2b usage-envelope prerequisite · Q3 pricing · Q4 circuit-breaker + bot + XFF · Q5 GDPR · Q6 kill-switch + owner decision.

## 2. Resolutions (consensus-corrected)

### Q1 — Schema (control namespace; money EXACT not float; explicit DD9 scope)
- **`control.cost_ledger`** (append-only, one row per settled call): `id`, `idempotency_key` (UNIQUE — at-least-once outbox redelivery safe), `tenant_id`, `workspace_id` (DD9 soft ids), `principal_kind` (`user|guest|anonymous|system`, CHECK — `system` for internal/title-gen/evaluator/embeddings/ARCH-07 runs), `principal_key`, `credential_source` (`platform|user|workspace`, CHECK — BYO-key calls attributed, see Q4), `provider_id`, `model_id`, `operation` (`chat|structured|tool|embedding`, CHECK), `input_tokens`, `output_tokens`, `usage_raw jsonb` (preserve provider usage), `cost_micro_usd bigint` (**integer micro-USD — money is NOT a float**; `events.costDeltaUsd:number` is a display projection, the ledger is exact), `pricing_version` (the `model_pricing` row id that priced it), `result` (`ok|capped|error|aborted`, CHECK), `trace_id`, `created_at`.
- **`control.budgets`** (reservation+settlement): explicit `tenant_id` + `workspace_id` columns (NOT just `scope_key` — DD9 needs them mechanically) + `scope_kind` (`tenant|workspace|user|anonymous_pool`, CHECK), `scope_key`, `period` (`monthly`, CHECK), `cap_micro_usd bigint?`, `reserved_micro_usd bigint`, `spent_micro_usd bigint`, `reset_at`, `updated_at`. Unique `(scope_kind, scope_key, period)`; index `(tenant_id, workspace_id)`. CHECK: non-negative spend/reserved/cap; `reserved >= 0`; period/reset invariants.
- **`control.blocked_attempts`** (audit, SEPARATE from cost_ledger — a rejected call is not a cost row but must be auditable): `id`, principal/scope, reason (`cap|rate|killswitch|no_pricing`), model, `created_at`.
- **`control.model_pricing`** — see Q3.

### Q2 — Write-path → RESERVE → SETTLE → REFUND (the v0 "decrement actual cost" was a budget-bypass bug)
The v0 "sync atomic decrement of ACTUAL cost with `WHERE spent+cost<=cap`" is **wrong**: actual cost is unknown until the call ends (esp. streaming), and a cap-conditional settle silently matches 0 rows past cap → cost never recorded → an actor at cap−ε streams forever, breaker never trips. Replace with **reserve/settle/refund**:
- **Pre-dispatch (sync, atomic, multi-scope, ONE transaction)**: compute a worst-case liability estimate = pricing × (input tokens [tokenizer/estimate] + `maxOutputTokens` [always finite — code defaults Claude 4096, raises for thinking budgets, index.ts:1428-1433] + reasoning + image/tool allowance). RESERVE it across ALL applicable budget rows (tenant ∧ workspace ∧ user ∧ anonymous_pool ∧ per-model) in ONE tx with a **deterministic lock order** (or a CTE that proves every required row passed) — `UPDATE control.budgets SET reserved_micro_usd = reserved_micro_usd + :est WHERE cap IS NULL OR spent+reserved+:est <= cap RETURNING`; if ANY scope rejects → rollback all + `blocked_attempts` row + cost-scoped error (reuse the context-budget hard-zone UX, cost-scoped). This is the circuit-breaker.
- **Settle (at stream end / done / error / abort — UNCONDITIONAL, no cap WHERE)**: with the actual usage (from Q2b), `spent += actual; reserved -= est` atomically; refund the (est − actual) delta. On ABORT (signal aborts early, usage never arrives, index.ts:1302/1467) estimate actual from the accumulated deltas (chat-service already aggregates them) and flag reconciliation; charge provider-billed partials. If a provider yields NO usage → either BLOCK that cost-governed model pre-dispatch, or charge the conservative estimate with a `reconcile` flag.
- **Crash safety**: reservations are TTL'd holds; a **reaper** (the BR-44 reaper analog) releases reservations whose call never settled (else a crashed process leaks reserved budget forever).
- **Async detail**: the `cost_ledger` row is written via the ARCH-14 outbox, **in the SAME transaction as the settle** (else spent and ledger diverge on crash) + the `idempotency_key` makes at-least-once redelivery safe.

### Q2b — Normalized usage/cost envelope at the LLM boundary (NAMED PREREQUISITE)
Plumb provider usage through `dispatchMeshStreamRaw`/`dispatchMeshGenerateRaw` into the unused `step-finish` StreamEvent (events/src/index.ts:33) so every provider (stream + non-stream) surfaces normalized `{inputTokens, outputTokens, cachedInputTokens?, reasoningTokens?, ...}`. Without this, Q2 has no actual cost to settle. This is prerequisite implementation work for the BR-implementation lot, named here.

### Q3 — Pricing → effective-dated, immutable, component-rate `control.model_pricing`; fail-closed
- `control.model_pricing`: `id`, `provider_id`, `model_id`, **component rates** `input_per_mtok`, `output_per_mtok`, `cached_input_per_mtok?`, `reasoning_per_mtok?`, `image_per_unit?`, `audio_per_unit?`, `embedding_per_mtok?`, `min_charge_micro_usd?`, `effective_from`, `effective_to?`. **Rows IMMUTABLE**; an **exclusion/CHECK constraint forbids overlapping `[effective_from, effective_to)` per (provider, model)**. Seeded from a **migration/admin fixture** (NOT the catalog — catalog has zero pricing; the v0 "seeded from catalog defaults" contradicted §0). The llm-mesh catalog stays the capabilities REGISTRY. **Missing pricing row = FAIL-CLOSED** for budget-gated principals (block + `blocked_attempts:no_pricing`), or a conservative default + alert — never silent cost=0.

### Q4 — Circuit-breaker + bot posture + XFF hardening (deploy-spanning)
- **Circuit-breaker** = the pre-dispatch reservation reject (Q2). A **global anonymous breaker** trips when the `anonymous_pool` is exhausted (protects the funder).
- **Bot posture**: extend `hono-rate-limiter` to the LLM routes (per-IP anonymous / per-user authed) as the cheap first line; cost-cap second.
- **BYO-key**: a `credential_source=user|workspace` call should NOT decrement the platform pool the same way (the user funds their own key) — posture: BYO-key calls are ledgered (attribution/audit) but exempt from platform-pool reservation (or a separate BYO budget). Reversible product call.
- **XFF hardening (security + deploy prerequisite)**: parse the FULL XFF chain, pick the **rightmost-untrusted hop**, but only if the immediate peer is a **configured trusted proxy**. The trust anchor spans the deploy: **fix `ui/nginx/default.conf` to forward `X-Forwarded-For` to the API; configure Traefik `forwardedHeaders.trustedIPs` + confirm the SCW LB preserves client IP (proxy-protocol/L7) — these live in the poc-k8s platform repo and are a NAMED deploy-verification gate** (if the LB does NOT preserve client IP, ALL anonymous traffic collapses into one bucket → one actor drains the pool; the existing auth rate-limiters share this latent defect). Dev/no-proxy fallback = socket IP via Hono `getConnInfo`; an UNRESOLVABLE IP must **reject**, never bucket as `'unknown'`.

### Q5 — GDPR identifiers
- Anonymous principal key = **keyed HMAC + a rotatable secret PEPPER** (stored outside the DB), **NOT a salted hash** (a salted IPv4 hash is brute-forceable over 2^32 = pseudonymization, still personal data). **IPv6 bucketed at /64** (else per-address rotation gives free per-address budgets, defeating the sub-cap). Retention/right-to-erasure = **ARCH-15**; on erasure, anonymize `cost_ledger.principal_key` (keep the aggregate cost, drop the link). Lawful basis = abuse-prevention legitimate interest (ARCH-15 confirms).

### Q6 — Kill-switch + the OWNER decision
- **Kill-switch**: global LLM-generation on/off (env + a `control` flag, short-TTL cached at the choke-point — not a per-call DB read) + per-scope (tenant/workspace) toggles; operator-driven, distinct from the budget circuit-breaker.
- **⚠️ OWNER-ONLY (flag, do not resolve)** — anonymous budget ownership: (1) pool model (reco: GLOBAL pool + per-ipHash sub-cap + per-/64 for IPv6); (2) monthly cap / who funds; (3) kill-switch + cap-adjust authority. → §6 batch.

## 3. Forks / gates
- F1 reserve/settle/refund (was decrement-first) ✔ · F2 effective-dated immutable component pricing ✔ · F3 guest-row + ipHash, only after trusted-proxy is real ✔.
- **Prerequisites/dependencies**: ARCH-14 outbox (async ledger + idempotency); ARCH-11 (tenant scoping); ARCH-15 (retention/erasure); **a deploy-side XFF verification gate in the poc-k8s repo + a `ui/nginx` forwarding fix** (cross-repo, named); the Q2b usage-envelope plumbing (named prerequisite). **Unblocks** ARCH-02 (anonymous quotas) + ARCH-07 (background-run budget hook).
- **OWNER-IRREVERSIBLE**: only the anonymous-budget ownership sub-decision (§6). BYO-key posture + pepper-rotation cadence are reversible.

## 4. Non-goals
No external billing/payment (D6 "later"); no ARCH-02 guest-merge/TTL; no ARCH-15 retention design (named); no ARCH-11 tenant migration; no usage-envelope IMPLEMENTATION (named prerequisite for the build lot).

## 5. Acceptance
Code-grounded, consensus-backed: `control.cost_ledger` (exact micro-USD, idempotency, credential_source, usage_raw) + `control.budgets` (explicit DD9 scope, reserve+spent, multi-scope atomic reservation) + `control.blocked_attempts` (separate audit) + `control.model_pricing` (immutable effective-dated component rates, non-overlap CHECK, fail-closed); RESERVE→SETTLE→REFUND write-path with TTL holds + reaper + same-tx outbox detail; the usage-envelope plumbing prerequisite named; bot rate-limit + cost circuit-breaker + XFF trusted-proxy hardening (with the named poc-k8s deploy gate + nginx fix) + HMAC-pepper + IPv6 /64; GDPR erasure → ARCH-15; kill-switch (operator) distinct from breaker (budget). The anonymous-budget OWNER sub-decision flagged for the batch. Becomes the ARCH-13 output; first control-plane proof.

## 6. ⚠️ Owner-decision (batched)
**Anonymous budget ownership** (arch:668): pool model (reco: global pool + per-ipHash sub-cap + IPv6 /64), monthly cap + who funds, kill-switch/cap authority. Schema + enforcement are parameterized by the `budgets.scope_kind=anonymous_pool` row + cap value → agnostic to the choice.
