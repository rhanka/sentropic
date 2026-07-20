# Decision dossier — Sentropic's standard LLM egress path (P1)

> Owner decision. WP16 Layer A/B. Grounded in code + specs at worktree
> `tmp/chore-app-capitalisation`. Facts carry file refs; uncertain items are tagged
> **TO CONFIRM** and collected in §8.

## 1. Décision demandée

Which egress path does the app adopt as its **standard**: keep the live in-process
mesh-direct path (app-owned pool), route egress through `@sentropic/llm-gateway`, or split
by mode — and, whichever is chosen, **name the single owner of the account pool
lifecycle** so the two recorded authorities stop overlapping.

## 2. Portée

- **In scope:** the LLM egress path from the chat/background call-sites down to the
  provider — `@sentropic/llm-mesh` (Layer-A pool SDK), `@sentropic/llm-gateway` (Layer-B
  egress server), `api/src/services/llm-runtime/*` (+ `mesh-dispatch.ts`), and
  `api/src/services/llm-account-transports.ts` (the app-side pool lifecycle).
- **Out of scope:** the model catalog / capability registry, provider-auth internals
  (OAuth import, refresh-endpoint semantics), UI enrolment surfaces, and the cross-user
  ToS/legal question itself (WP16 D0 — a separate owner gate, referenced but not decided here).

## 3. État réel (facts with file refs)

**3.1 The live path is 100% mesh-direct, in-process.**
Chat route → chat service (`api/src/services/chat-service.ts:9`,
`chat/mesh-dispatch-adapter`) → `llm-runtime/index.ts` (imports
`dispatchMeshGenerateRaw`/`dispatchMeshStreamRaw`, lines 26-28) → `mesh-dispatch.ts`. There,
`applicationLlmMesh = createLlmMesh(...)` (`mesh-dispatch.ts:338-349`) is built over an
in-process provider client and dispatched by `dispatchMeshGenerateRaw`/`dispatchMeshStreamRaw`
(`mesh-dispatch.ts:392-403`). It is load-bearing: 5 generate call-sites
(`index.ts:1039,1107,1175,1229,1294`) and 5 stream call-sites
(`index.ts:1445,1615,1776,1969,2203`). `@sentropic/llm-mesh` is `0.8.1`, live.

**3.2 The gateway is functional in-package, with zero app consumer.**
`packages/llm-gateway` is `0.9.0` (published) — its README still says "v0 scaffold /
version 0.0.0 / 501 stubs" and is **stale vs the code**. `createGatewayRouter`
(`router/index.ts:138-232`) runs the **real** personal-passthrough flow when given flow deps:
`flowDeps` is built only when `resolveTarget && metering` are supplied (`:153-161`); with
them, `runJsonFlow`/`runStreamFlow` execute (`:191`, `:206`) and return provider-native
200/SSE; **without** them the routes return a provider-shaped `501` (`:166-168`, scaffold
mode). The flow is real, not a stub: `flow.ts:1-22` documents the v0 personal-passthrough
orchestration and `personal-passthrough/{caller-auth,pool,dispatch,metering,target}.ts` are
concrete modules. **No `@sentropic/llm-gateway` import exists in `api/src`, `ui/src`, or the
IdP** (only a doc-string mention). So: functional, unwired.

**3.3 The app re-implements the pool/lease/reservation/cooldown lifecycle app-side.**
`api/src/services/llm-account-transports.ts` owns, in raw SQL:
- **Selection + lease + reservation** in one short DB tx — `acquireDbAccountTransport`
  (`:908-1161`): `BEGIN`, expire stale reservations, `pg_advisory_xact_lock`, lease lookup
  `FOR UPDATE`, eligible-account select `FOR UPDATE SKIP LOCKED` (`:1038`), lease+reservation
  insert, `COMMIT`, provider call **outside** the tx. `RESERVATION_TTL_MS = 5min` (`:121`).
- **Sticky binding** via an HMAC stable-session id over workspace/user/affinity/provider/
  model/lease, keyed on `JWT_SECRET` — `computeStableSessionId` (`:283-307`).
- **Cooldown + reauth outcome** — `recordLlmAccountTransportOutcome` (`:1220-1261`): sets
  `cooldown` + `cooldown_until` on rate-limit (`:1252`), `reauth_required` on auth-fail.
- **Coordinated token refresh** — `refreshCodex/ClaudeCodeTokenIfNeeded` (`:755`, `:818`),
  concurrent refreshes coalesced via in-process maps (`:124-125`); secrets via
  `encryptSecret`/`decryptSecretOrNull` (`:6`).
- Consumers: `provider-connections.ts` and `llm-runtime/index.ts` (acquisition →
  `authOverride` at `:1111,1619,2207`; `recordOutcome` at `:1140,1700,2417`).
This mirrors, in app SQL, exactly the discipline the gateway spec says llm-mesh's
`AccountTransportCoordinator.acquire()` should own (see 3.4). The demonstrated overlap is the
pool lifecycle **only** — caller-auth and BR-47 financial settlement are **not** duplicated.

**3.4 Two recorded authorities overlap.**
- `SPEC_EVOL_LLM_GATEWAY.md` — the **gateway-owned** direction: the gateway OWNS
  caller-auth, pool state, quota reservation, account selection, auth-swap, dispatch,
  settlement (§1, `:22-34`); pool STATE = gateway-owned DB + KMS (§4, `:114-123`); and D4:
  "the api mesh-dispatch routes THROUGH the gateway (stage: mount → remove direct bypasses)";
  "`mesh-dispatch.ts` becomes gateway-internal or is deleted" (§6, `:132-139`; §7 D4 `:173`).
  Notably it says to **REUSE** the account-transports sticky rules (`:6-8`) and to select via
  llm-mesh's **public** `AccountTransportCoordinator.acquire()` (§1 note `:30-34`).
- `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` — the **app-owned coordinator** direction:
  llm-mesh stays DB-agnostic (D2, `:64-70`); "Sentropic API owns Postgres, encryption,
  migrations, coordination"; leases/reservations/refresh/cooldown are app-owned (D3-D9,
  `:71-186`). This is the spec `llm-account-transports.ts` actually implements — but as raw
  app SQL, **not** behind the llm-mesh coordinator port the gateway spec names.
  → Same pool discipline, two homes. Not a contradiction of intent, but an **unresolved
  owner + an unexecuted integration**: no BR owns the reconciliation (doc-final §6).

**3.5 The WP16 D0 ToS/cross-user gate — and what "personal passthrough" unblocks.**
`SPEC_EVOL_LLM_GATEWAY.md` §7 D0 (`:142-167`): cross-user pooling of paid Claude/Codex
accounts may breach provider ToS → requires **explicit owner acceptance + a FAIL-CLOSED kill
switch** (`crossUserPoolEnabled`, default OFF); while OFF the gateway rejects any non-personal
selection path. The **unblocked** mode is **personal-passthrough** (caller == provider: a
caller uses only their OWN enrolled accounts). `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` D12
(`:205-211`) echoes it: subscription/cross-user pooling off by default, per-transport admin
kill switch, owner ToS acceptance. So the gateway's distinguishing value (cross-user pooled,
metered, authorized egress) is **legally gated**; only personal-passthrough — which the app
already does in-process — is shippable today.

## 4. Enjeux

- **Metering / BR-47 anchor conflict.** `SPEC_EVOL_QUOTA_LEDGER.md` (ARCH-13) Q2b names the
  usage envelope prerequisite **at the app mesh-dispatch boundary** — "plumb provider usage
  through `dispatchMeshStreamRaw`/`dispatchMeshGenerateRaw`" — and records that provider usage
  is currently **discarded on every streaming path** (`llm-runtime/index.ts:1363/1508/…`). The
  gateway spec §5 instead settles the `cost_event` **inside the gateway**. So the two specs
  place the single metering point in two different layers. Neither is implemented yet — this
  is the moment to pick the boundary rather than build it twice.
- **Cross-user legality.** Any egress shape that pools across users is behind the D0
  kill-switch; the standard-path decision must not silently pre-commit to it.
- **Silent drift of duplicated pool logic.** Two homes for lease/reservation/cooldown/refresh
  means a fix (e.g. a cooldown or refresh-coalescing bug) can land in one and not the other —
  the exact maintenance hazard doc-final flags as the P1.
- **One-owner clarity.** No BR owns the pool contract; §6 of the inventory asks the owner to
  name one. Until then every egress change re-litigates ownership.
- **Self-host / portability.** A separate-service gateway is the security/cost chokepoint and
  the Layer-C `ANTHROPIC_BASE_URL` drop-in (remote consumers). Retiring it forfeits that; over-
  investing in it now (a network hop for personal-passthrough) buys nothing functional today.

## 5. Options

### Option A — Gateway-first (adopt the recorded D4 target now)
Route the chat boundary and background call-sites through `@sentropic/llm-gateway` via an
HTTP/base-URL `MeshDispatchPort` adapter; the gateway owns pool + metering; retire the app
pool and make `mesh-dispatch.ts` gateway-internal.
- **Effort:** **L** (deploy a separate service or mount it; migrate 10 call-sites; move pool
  state + secret custody; readiness on DB+secret-store+pool).
- **Reversibility:** **Low** — wire contract + service topology become consumer-visible and
  irreversible once depended on (§7 D0 "IRREVERSIBLE once consumers depend").
- **Risk:** High — adds a hop with **zero functional gain** while cross-user is D0-gated;
  fights the ARCH-13 metering anchor; secret-custody migration is high-value-target work.
- **Owner:** mesh lane (build) + architect (topology sign) + api (call-site migration).
- **Effect on app-pool duplication:** eliminates it (app pool deleted) — but at maximum
  irreversible cost, before the gateway's reason-for-being (cross-user) is legal.

### Option B — Sanctioned mesh-direct (bless the app-owned shape as permanent)
Declare in-process mesh-direct + `llm-account-transports.ts` the permanent standard path;
re-scope the gateway to external Layer-C consumers only, or park it.
- **Effort:** **S** (mostly a spec/doc reconciliation; supersede the gateway's D4).
- **Reversibility:** Medium — cheap to state, but forfeits investment and re-opens later if
  cross-user/metered egress is needed.
- **Risk:** Medium — throws away an owner-ratified, functional, published package and the
  Layer-C drop-in; leaves BR-47 without a single chokepoint.
- **Owner:** architect (supersession decision) + api (owns the path).
- **Effect on app-pool duplication:** removes the *overlap* by declaring one winner (app), but
  the pool stays as bespoke app SQL rather than the reusable coordinator port.

### Option C — Split-by-mode (recommended) — personal in-process, gateway for cross-user/metered
Personal-passthrough stays the **in-process mesh-direct** path (today's live shape). The
gateway is the **sanctioned front door for cross-user / metered / Layer-C egress**, activated
only when D0 clears and BR-47 needs a chokepoint. Boundary = *ownership of the account*:
caller==provider ⇒ in-process; anything cross-user or externally-consumed ⇒ gateway.
- **Effort:** **M** overall, but **S for the first reversible step** (the pool-contract
  convergence in §6).
- **Reversibility:** High — no topology commitment now; the gateway is adopted later behind
  the same pool contract if/when D0 + BR-47 force it.
- **Risk:** Low — matches what is legal and live today; defers the irreversible topology bet.
- **Owner:** architect (writes the boundary + names the pool owner) → mesh lane (converges the
  pool contract) → api (keeps the live path).
- **Effect on app-pool duplication:** removes it by converging on **one** pool contract
  (Option D's mechanism) consumed by both the in-process path and, later, the gateway.

### Option D — Converge the pool contract only, defer topology
Extract the app SQL coordinator behind llm-mesh's public `AccountTransportCoordinator.acquire()`
port (the surface the gateway spec already names), so the in-process path and the gateway share
**one** pool implementation; leave the in-process-vs-separate-service topology undecided.
- **Effort:** **M** (refactor `llm-account-transports.ts` behind the coordinator port + tests).
- **Reversibility:** High — pure de-duplication, no consumer-visible topology change.
- **Risk:** Low-Medium — must preserve the D2 boundary (DB/secrets app-owned; port in llm-mesh).
- **Owner:** mesh lane (port) + api (adapter).
- **Effect on app-pool duplication:** **eliminates the duplication directly**, but leaves the
  "standard egress path" question (§1) formally unanswered — it is the *mechanism*, not the
  *strategy*. Best consumed **as the first step of Option C**, not as a standalone answer.

## 6. Préconisation — Option C (split-by-mode), executed via the Option-D first step

- **It matches reality and legality.** Personal-passthrough is the only unblocked mode
  (§3.5); the live in-process path already serves it correctly. The gateway's value is
  cross-user/metered/Layer-C egress, which is D0-gated — so make it the *future front door*,
  not a hop we insert today for no gain.
- **It resolves the actual P1** (overlapping pool authorities, §3.4/§4) without an irreversible
  bet: one pool contract, one owner, both paths consuming it.
- **It keeps the metering decision open the right way.** With one pool contract and a named
  owner, BR-47 can anchor its single settlement point deliberately (app boundary per ARCH-13
  Q2b now; gateway §5 when the gateway becomes the chokepoint) instead of being built twice.
- **It preserves the owner-ratified gateway** (name, ingress, Layer-C drop-in) and its 65/65
  contract tests, while refusing to over-invest before D0.
- **Smallest reversible first step:** land the **pool-contract convergence** (Option D) —
  refactor `llm-account-transports.ts` to sit behind llm-mesh's public
  `AccountTransportCoordinator.acquire()` port (DB/secret custody stays app-owned per
  ACCOUNT_TRANSPORTS D2), keeping the in-process dispatch unchanged. This stops the duplication
  **now**, names one owner, changes no egress topology, and is fully revertible. The
  A-vs-C-full topology choice then remains a later, well-scoped decision gated by D0 + BR-47.

## 7. Décision & dépendances

- **Who decides:** the **owner** picks the standard path and ratifies the single pool owner;
  the **architect** writes the split-by-mode boundary into the two specs and marks the
  superseded clauses (gateway §6/§7-D4 "delete mesh-dispatch" is downgraded from *now* to
  *when the gateway becomes the chokepoint*).
- **Hard dependencies / what must be TRUE before any build dispatch:**
  1. **Named pool owner** — the reconciliation of the two specs into one authority (no BR owns
     it today; doc-final §6). This gates everything.
  2. **WP16 D0 ToS kill-switch** — must stay OFF/fail-closed; the standard-path decision must
     not activate cross-user pooling. Any gateway cross-user build is blocked on the owner
     legal gate (`crossUserPoolEnabled`).
  3. **BR-47 metering anchor** — the owner/architect must confirm the single settlement
     boundary (app mesh-dispatch per ARCH-13 Q2b vs gateway §5) before either is built, so the
     usage envelope is plumbed once.
  4. **Build ownership = mesh lane** (`claude:mesh`) for the coordinator port + gateway; **api**
     for the in-process adapter; **architect** for the spec supersession. No code lot is
     dispatchable until the recorded direction is chosen or explicitly superseded (doc-final §7,
     ordered step 1).

## 8. Points à confirmer (TO CONFIRM)

- **Gateway README staleness** — README claims v0/0.0.0/501 while `package.json` is `0.9.0`
  and the router runs the real flow. Confirm whether `0.9.0` is actually published to npm and
  whether the personal-passthrough flow has an end-to-end integration test beyond the 65/65
  unit suite. **TO CONFIRM.**
- **BR-47 settlement boundary** — ARCH-13 Q2b (app mesh-dispatch) vs gateway §5 (gateway) is an
  open placement question; which is the intended single chokepoint is not decided in code. **TO
  CONFIRM with architect.**
- **Coordinator-port readiness** — the gateway spec defers a "pure planner" to llm-mesh v0.6+
  and selects only via `acquire()`; whether `acquire()` at `0.8.1` can host the app's raw-SQL
  lease/reservation semantics without a contract bump is unverified. **TO CONFIRM.**
