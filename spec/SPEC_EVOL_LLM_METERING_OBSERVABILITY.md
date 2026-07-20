# LLM egress OBSERVABILITY / METERING — wiring study (P1 blocker answer)

> Research study, grounded in code + specs at worktree `feat/llm-mesh-code-assist-account`
> (`/home/antoinefa/src/sentropic`). File refs are absolute-in-repo. Uncertain items tagged
> **TO CONFIRM** (§6). Answers the owner blocker: *"is observability/metering correctly wired,
> or is it a missing lib/layer?"* — for a gateway-first PERSONAL-PASSTHROUGH target.

## 1. Observability / metering MAP

Legend: **captured** = the layer has usage/cost in hand; **emitted** = it hands it to a seam;
**persisted** = it reaches durable storage; **discarded** = dropped with no consumer.

| Layer | captured? | emitted? | persisted? | discarded? | File ref |
|---|---|---|---|---|---|
| **app llm-runtime — non-stream generate** | NO (`usage: null` hard-coded) | no | no | YES | `api/src/services/llm-runtime/index.ts:1086,1168,1222,1276` |
| **app llm-runtime — stream `done`** | PARTIAL (only OpenAI-Responses `response.completed`) | yes (`done.data.usage`) | no | YES (no consumer) | `index.ts:2394-2395`; other stream paths yield `{data:{}}` (`:1363/1508/1700/1878/2187` per ARCH-13 §0) |
| **app chat-service (stream consumer)** | NO | — | no | YES (drops `done.usage`) | `grep "\.usage" api/src/services/chat-service.ts` → **empty** |
| **app mesh-dispatch (llm-mesh host)** | NO — mesh built with **no hooks** | no | no | YES (never subscribes) | `api/src/services/llm-runtime/mesh-dispatch.ts:338-349` (`createLlmMesh({ registry })`, no `hooks`) |
| **llm-mesh lib — `onResponse` hook** | YES (`usage: TokenUsage`) | YES (hook seam) | no | seam UNUSED by app | `packages/llm-mesh/src/mesh.ts:148` (generate), `:162` (stream done), `:21-25` (`LlmMeshResponseEvent.usage`) |
| **llm-gateway flow — `settle()`** | YES (normalized `SettleUsage`, never-zero estimate) | YES (`MeteringSink.settle`, always ×1/req) | no | layer has **zero app consumer** | `packages/llm-gateway/src/flow.ts:201-230,377-425`; `CostContext` = v0 stub `ports/cost-context.ts:1-18` |
| **llm-gateway metering sink** | receives settle ctx | — | NO (in-memory / noop) | explicitly "BR-47 later lot" | `packages/llm-gateway/src/personal-passthrough/metering.ts:1-41` |
| **DB — `chat_generation_traces`** | debug payloads only (`openai_messages`, `tool_calls`, `meta`) | — | YES but **no usage/cost columns** | usage/cost N/A | `api/drizzle/0015_chat_generation_traces.sql`; `api/src/db/schema.ts:713-738`; writer `api/src/services/chat-trace.ts:36-81`; `meta` = sizes/timings/flags only (`chat-service.ts:3643-3650`) |
| **DB — `control.*` (ARCH-13 ledger home)** | — | — | **NO cost_ledger / budgets / model_pricing / blocked_attempts table exists** | entire BR-47 layer absent | `api/drizzle/control/*.sql` → only `event_outbox`, `app_*`, `object_type_definitions`, `connector_tenant_enrollments`; `grep cost_ledger\|budgets\|model_pricing` → NONE |
| **contracts — `CostContext`** | type only | — | no | DEFINED but UNWIRED | `packages/contracts/src/index.ts` (not imported anywhere in `api/src`) |

## 2. What is actually wired vs not

**Wired today: nothing that persists a usage or cost record.** Observability of LLM egress is
NOT wired end-to-end. Every place usage exists, it is dropped before reaching storage:

- **Drop #1 (non-stream).** Four of the five non-stream generate paths fabricate an OpenAI
  `ChatCompletion` with `usage: null` (`index.ts:1086/1168/1222/1276`); only OpenAI
  chat-completions passthrough keeps provider usage. So structured/tool/title-gen/embedding-ish
  non-stream calls carry no usage at all.
- **Drop #2 (stream).** Provider usage survives only on the OpenAI-Responses `response.completed`
  branch (`index.ts:2394-2395`); the other streaming providers emit `done: {data:{}}`. Even the
  one branch that yields `done.data.usage` is then **dropped by the consumer** — `chat-service.ts`
  never reads `.usage` (grep empty). This is the exact "provider usage discarded on every
  streaming path" the ARCH-13 spec names as ground truth (`SPEC_EVOL_QUOTA_LEDGER.md:8-9`).
- **Drop #3 (the strongest existing seam, unused).** `@sentropic/llm-mesh` already emits a fully
  normalized `onResponse` event carrying `usage` for BOTH generate and stream-done
  (`mesh.ts:148,162`). This is the natural in-process observability tap. But
  `mesh-dispatch.ts:338-349` constructs the mesh **without a `hooks` object**, so the app never
  subscribes. The seam is emitted-by-lib, discarded-by-app.
- **DB reality.** `chat_generation_traces` is a **debug/trace** table (exact payloads, tool calls,
  timings; 7-day purge) with **no token or cost column** — not a metering store. The `control`
  schema (the ARCH-13-designated home) exists and even carries the ARCH-14 `event_outbox`
  chokepoint the ledger would ride, but has **zero** cost/budget/pricing tables. BR-47 is a study,
  not an implementation: no `control.cost_ledger`, no `control.budgets`, no `control.model_pricing`.

**Existing seams (present, ready, unconsumed):**
1. `llm-mesh` `LlmMeshHooks.onResponse{usage}` — in-process tap, works today, no host wiring.
2. `llm-gateway` `MeteringSink.settle(SettleContext{cost, usage, account})` — always fires once per
   request, normalized + never-zero + redacted; but the whole gateway has no app consumer.
3. `contracts.CostContext` + `control.event_outbox` — the attribution shape and the async
   settlement transport that BR-47 was designed to sit on; defined, un-wired.

Net: three good seams at three layers; **not one of them terminates in a persisted row.** The
observability gap is a wiring + storage gap, not a design vacuum.

## 3. Three candidate homes for the observability / ledger layer

**(a) llm-mesh `onResponse` usage hook (in-process tap).**
- *Pros:* already emits normalized usage for stream + non-stream; lives on the CURRENT live path
  (`mesh-dispatch` → `@sentropic/llm-mesh`); wiring is one `hooks:{onResponse}` argument; and the
  SAME hook fires whether the mesh runs in-process OR inside the gateway (the gateway dispatches
  through llm-mesh too) → topology-independent.
- *Cons:* a hook is fire-and-forget observability, not a transactional reserve/settle; it sees
  usage but not the pre-dispatch budget reservation ARCH-13 Q2 requires. Good for the *envelope*,
  insufficient alone for *quota enforcement*.

**(b) llm-gateway metering layer (`MeteringSink` at the egress boundary).**
- *Pros:* purpose-built as the single chokepoint (spec §5): one settle per request, normalized,
  never-zero, redacted account view, `CostContext` attribution baked in. This is the "correct"
  long-term home for a gateway-first target.
- *Cons:* the gateway has **no app consumer** today (no import in `api/src`/`ui/src`), `CostContext`
  is a v0 stub (real resolver = Lot 2), and the sink itself is in-memory/noop (persistence = "BR-47
  Lot 4"). Adopting it as the home means first wiring the whole gateway into the app — a topology
  bet that, for personal-passthrough, buys no functional gain today (dossier §5 Option A).

**(c) dedicated app ledger layer (BR-47 `control.cost_ledger` + a small app sink module).**
- *Pros:* it is the actual missing piece — the durable, exact (micro-USD), attributed store; rides
  the existing `control.event_outbox`; the only layer that can do reserve→settle→refund and
  fail-closed pricing (ARCH-13 Q1-Q3). Persistence has to live here regardless of which tap feeds it.
- *Cons:* biggest build (schema + pricing table + reserve/settle/refund + reaper); ARCH-13 is
  doc-only; needs the usage-envelope prerequisite (a) before it has anything to settle.

**RECOMMENDATION (gateway-first personal-passthrough target).** Split *tap* from *store*:
- The **store** is (c): a dedicated app-side ledger (`control.cost_ledger` + a thin
  `api/src/services/llm-metering/` sink). Persistence must live in the app/control plane; neither
  the mesh lib (DB-agnostic by D2) nor the gateway-in-memory sink can own it.
- The **tap** is (a) NOW and (b) LATER, feeding the SAME store. Wire the ledger sink to the
  `llm-mesh onResponse` hook today (in-process, works on the live path); when the gateway becomes
  the front door, point the gateway's `MeteringSink.settle` at the same app sink. Because the
  gateway dispatches through llm-mesh, the hook and the gateway sink observe the same usage — so
  there is exactly ONE settlement point that survives the topology change. This matches the
  dossier's Option-C direction (personal in-process now, gateway later) and keeps BR-47's single
  chokepoint intact across the move.

## 4. Is a NEW lib / layer warranted?

**No new published package. Yes to one small app layer + a schema.** The owner's hunch ("c'est
peut-être une lib ou un layer en plus") is half right:
- **Not a lib:** the reusable observability seams already exist and are published — `llm-mesh`
  `onResponse{usage}` (`mesh.ts:148,162`) and the gateway `MeteringSink`/`CostContext` ports. A
  fourth library would duplicate them. The gap is that these seams are unconsumed, not missing.
- **Yes, a thin app LAYER:** an app-owned **usage/cost sink + ledger** — `control.cost_ledger`
  (BR-47 schema) plus a small `api/src/services/llm-metering/` module that (i) subscribes to the
  mesh hook, (ii) prices via `control.model_pricing`, (iii) writes the settle row via the existing
  `control.event_outbox`. This is app/control-plane by nature (D2 keeps llm-mesh DB-agnostic; the
  gateway sink is deliberately non-persistent). It is a *layer*, ~1 module + 1 migration, not a
  package. The two genuinely-missing things are therefore: the **usage-envelope plumbing** (ARCH-13
  Q2b, named prerequisite) and the **persistence layer** (BR-47). Both are app-side.

## 5. Gateway-first personal-passthrough wiring plan WITH metering

Ordered, reversible-first. Each step: owning package · effort · reversibility · what's missing.

1. **Usage-envelope plumbing (ARCH-13 Q2b prerequisite).** Make every provider path surface
   normalized `{inputTokens, outputTokens, cached?, reasoning?}` — stop returning `usage: null`
   on the non-stream paths and stop yielding `{data:{}}` on the stream paths; route it into the
   unused `step-finish`/`done.usage` envelope. *Owner:* api (`llm-runtime/index.ts`) + adapters in
   `@sentropic/llm-mesh`. *Effort:* **M**. *Reversibility:* High (additive). *Missing:* per-provider
   usage extraction on 4/5 non-stream + 4/5 stream paths. **Blocks everything below.**
2. **Wire the llm-mesh `onResponse` hook in the app.** Pass `hooks:{ onResponse }` to
   `createLlmMesh` in `mesh-dispatch.ts:338-349`; the handler forwards the normalized usage +
   provider/model + attribution to the sink of step 4. *Owner:* api. *Effort:* **S**.
   *Reversibility:* High (one arg). *Missing:* the hook argument (today none).
3. **`control.cost_ledger` (+ `model_pricing`, `budgets` if enforcing).** Add the BR-47 schema in
   the `control` namespace (append-only, exact micro-USD, `idempotency_key`, `credential_source`,
   `agent_id`, `usage_raw`), rides `control.event_outbox`. *Owner:* api/drizzle + architect.
   *Effort:* **M** (ledger only) / **L** (with pricing + reserve/settle/refund + reaper).
   *Reversibility:* Medium (migration; additive control-schema, no cross-namespace FK).
   *Missing:* the entire schema (control schema exists; these tables do not).
4. **App metering sink (`api/src/services/llm-metering/`).** Consume step 2's hook, price via
   `model_pricing`, settle one ledger row via the outbox. Start observe-only (record usage/cost),
   add reserve→settle→refund enforcement later. *Owner:* api. *Effort:* **M**. *Reversibility:*
   High (observe-only) → Medium (enforcing). *Missing:* the module (does not exist).
5. **Point the gateway `MeteringSink` at the same app sink (gateway-adoption step).** When the
   gateway is mounted/deployed, replace `noopMeteringSink`/`RecordingMeteringSink` with an adapter
   delegating to step 4's sink; resolve the real `CostContext` (gateway Lot 2, caller-auth via
   `auth-hono`). *Owner:* mesh lane + api. *Effort:* **M**. *Reversibility:* Medium (topology).
   *Missing:* gateway app-integration (no import today), real `CostContext` resolver, persistent sink.
6. **(Deferred, gated) reserve/settle/refund + circuit-breaker.** Pre-dispatch reservation, TTL
   holds + reaper, fail-closed pricing (ARCH-13 Q2-Q4). *Owner:* api + architect. *Effort:* **L**.
   *Reversibility:* Low once enforcing. *Missing:* all of it.

**Dependencies / gates:**
- **BR-47 anchor (single settlement point).** ARCH-13 Q2b places it at the **app mesh-dispatch
  boundary** ("plumb usage through `dispatchMeshStreamRaw`/`dispatchMeshGenerateRaw`"); gateway §5
  places it **inside the gateway**. The recommendation reconciles them: one app sink fed by the
  mesh hook, which is *inside* the gateway when the gateway ships — so both specs' chokepoints
  collapse to one code path. Architect must ratify this before steps 3-4 build (dossier §7 dep 3).
- **ACCOUNT_TRANSPORTS D2 boundary.** Persistence/pricing MUST stay app-owned; llm-mesh stays
  DB-agnostic (`SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md:64-70`). Steps 3-4 respect D2 (the layer
  is app-side; the lib only emits the hook).
- **llm-mesh `acquire()` port readiness.** Metering does NOT need `acquire()`; it rides
  `onResponse`, which is already public and stable — so the observability layer is unblocked by the
  pool-contract convergence (dossier Option D). It can land independently of the topology decision.
- **WP16 D0.** Personal-passthrough only; the metering wiring must not activate any cross-user pool
  (kill-switch OFF/fail-closed). Metering is attribution/audit — it does not change the D0 posture.

## 6. Points à confirmer (TO CONFIRM)

- **BR-47 settlement boundary** — ARCH-13 Q2b (app mesh-dispatch) vs gateway §5 (gateway) is an
  undecided placement in code. The recommendation unifies them via the mesh hook, but the architect
  must ratify the single anchor before build. **TO CONFIRM with architect.**
- **Version deltas** — this worktree has `@sentropic/llm-gateway@0.8.0` and `@sentropic/llm-mesh@0.8.0`
  (`packages/*/package.json`), while doc-final/dossier cite 0.9.0 / 0.8.1 (revision `f1f3622b3`).
  Confirm which revision is authoritative and whether the mesh `onResponse` seam is unchanged there.
  **TO CONFIRM.**
- **Gateway `CostContext` resolver + persistence** — `cost-context.ts` is a v0 shape stub ("real
  resolver lands in Lot 2") and the sink is in-memory ("BR-47 ledger wiring is a later lot").
  Confirm neither is silently expected to persist today. **CONFIRMED absent in code; flag for owner.**
- **Non-stream usage availability** — step 1 assumes every provider adapter CAN surface usage on the
  non-stream path (today hard-coded `null`). Confirm each provider's non-stream response actually
  carries token usage (Anthropic/Gemini/Mistral/Cohere/GCP), else those calls settle on estimate.
  **TO CONFIRM per provider.**
- **`control.event_outbox` reuse for cost rows** — ARCH-13 says the ledger row is written in the
  same tx as settle via the ARCH-14 outbox. Confirm the existing `control.event_outbox`
  (`api/drizzle/control/0000_*.sql`) is the intended transport and consumable from a metering sink.
  **TO CONFIRM.**
