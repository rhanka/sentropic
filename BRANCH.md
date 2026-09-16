# feat: cluster-mesh agent-to-agent messaging client (0.10.1)

## Objective
Expose a public, ergonomic agent<->agent messaging client over the EXISTING M01 `BoundedLocalMessagingStore`, so a consumer (h2a `h2a send`/`h2a_send`) can send a notify/wake/text message to a peer and drain+ack its inbox without reimplementing the store wiring or the envelope. Additive-only. Bump `@sentropic/cluster-mesh` 0.10.0 -> 0.10.1 (patch).

## Scope / Guardrails
- REUSE the existing M01 store (`BoundedLocalMessagingStore` put/pop|drain/ack) — do NOT invent a 2nd channel.
- SEPARATE from the actuation/custody seam: this is the messaging channel (notify/wake/text), NOT the session-control actuation path. Do NOT route through RegistrationGate/session-router; do NOT touch `ActuationRequest`/`ActuationResult`/`RegistrationDecision` (frozen), nor `@sentropic/contracts`, nor migration 0007. `MessageActuationIntent{kind:'session-control'}` stays the actuation path — the new client does not use it.
- Strictly ADDITIVE: new client module + a Message envelope helper + one `index.ts` export line. Reuse existing types (`MeshMessage`, `MessagePayload`, `MessageAddress`, `PutMessageRequest`/`Result`, pop/drain, `AckMessageRequest`); if a `kind` discriminator is needed, add it additively/optionally.
- Auth: reuse the existing signing (custody-crypto ed25519 / the store's product-authorization) — signed envelope, no new crypto.
- Make-only gates on `ENV=test-*`; never `ENV=dev`. No push, PR, publish, or attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/messaging/message-client.ts`
  - `packages/cluster-mesh/src/messaging/index.ts`
  - `packages/cluster-mesh/tests/messaging/message-client.spec.ts`
  - `packages/cluster-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/contracts/**`
  - `packages/cluster-mesh/src/runtime/registration.ts`
  - `api/drizzle/0007_handy_morlocks.sql`
  - `api/drizzle/control/0007_cluster_mesh_r13.sql`
  - `api/drizzle/control/meta/0007_snapshot.json`
  - `api/drizzle/meta/0007_snapshot.json`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Declare a `BRSEND-EXn` item in `## Feedback Loop` before touching a forbidden path.

## Feedback Loop
- [x] No exception is required for the scoped package addition.

## AI Flaky tests
- [x] N/A; all messaging-client tests are hermetic and use the in-memory store.

## Orchestration Mode
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] The client, tests, and version lots are sequential and independently committed.

## Proposed API (owner/h-cond shape — confirm exact types against the store)
- `sendMessage({ to: <peer instance/session id>, message, kind?: 'wake'|'notify'|'text' }) -> { ok: boolean, messageId }` (maps to store.put: MessageAddress mailbox = peer id, MessagePayload carries message+kind).
- `receiveMessages({ instance }) -> MeshMessage[]` (maps to pop/drain for that mailbox).
- `ack(messageId)` (maps to store.ack).
- Placement inside cluster-mesh (files) = conductor/leg call; expose from `src/index.ts`.

## Plan / Todo
- [x] **Lot 1 - messaging client** over BoundedLocalMessagingStore (sendMessage/receiveMessages/ack + signed envelope), exposed on the public index. Reuse store + signing; keep separate from actuation.
- [ ] **Lot 2 - Tests** (no live network): send->receive->ack round-trip; kind carried; envelope signed/verified; at-least-once + ack semantics preserved; separation from actuation intent.
- [ ] **Lot 3 - Version + gates**: bump 0.10.0 -> 0.10.1; `make typecheck-cluster-mesh` + `make test-cluster-mesh SCOPE=packages/cluster-mesh/tests` + `make typecheck-api REGISTRY=local`; commit atomically; no push/PR/publish.
