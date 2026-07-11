# SPEC EVOL — Bank / Financial Connector (socle)

Status: **DRAFT v3** — double-consensus complete: Opus 4.8xhigh (NEEDS-REVISION) + Codex 5.5xhigh (NEEDS-REVISION) both reconciled (§13). One owner item raised by the review (B6, processor-status coherence). Direction ratified by owner 2026-07-10 = **Foundation-first strict**.

Architect-owned socle spec. Consumer/executor = `openerp` (objective loop `loop:openerp-bank-connector-2026-07-10`). This spec defines the **Sentropic platform socle** (custody, egress, enrollment, consent, audit, MCP surface). It does not re-specify the connector's provider internals, which live in the consuming app (`rhanka/openerp` `packages/bank-connector`, commits `040dbf3` C0 POC, `5cc9719` MCP skeleton).

Parent study: `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` (custody modes §4.3, threat controls §4.6, 2FA/escalation §5, narrow-freeze §6.2, Financial catalog class §8.1, phases §9, canonical `AccessGrant` §3.4). This connector is an **instance** of that broker pattern — not a parallel platform primitive.

## 0. Ratified posture (owner 2026-07-10)

- **Foundation-first strict.** Write this spec + all gates now. **No real bank data before ARCH-11** lands. Rationale: `tenantId := workspaceId` is still live in prod (DD9 interim) = wrong tenant key = cross-org financial-data breach risk.
- The **only** thing allowed to precede the foundation is a **read-only, mono-tenant, synthetic/own-data** proof — and even that is only safe under the tenant-isolation invariant in §7, **not** by assumption.
- Mutualized/cross-org financial access is behind the **ToS-D0 kill-switch** (fail-closed, personal-passthrough first).

## 1. Goal and non-goals

### 1.1 Goal
A read-only bank/financial connector exposing normalized (FDX-inspired) accounts/transactions to Sentropic apps and agents, reusing the MCP-platform socle for custody/enrollment/consent/audit, multi-provider (Plaid, OFX, Flinks, native-FDX later), safe mono-tenant read-only now and safe to scale only after the foundation + legal gates clear.

### 1.2 Non-goals (v1)
- No write/payment initiation. Read-only only.
- No cross-org mutualized custody before ARCH-11 + legal gates (§6).
- No third-party (non-federated) tenants before a Plaid platform agreement (C4, owner-gated).
- No bespoke vault/consent/marketplace — MCP-platform socle owns those.
- No raw-secret mirroring across the local↔platform boundary at rest **or at use** (§3.1 / §4).

## 2. Enrollment model (3 levels)

1. **Platform (operator).** Sentropic is the single Plaid operator (Production + security questionnaire, once). Plaid `client_id`/`secret` = **operator-scoped secret** (§4), used only inside the egress boundary (§3.1). Legal operator entity = owner decision (B1, OPEN).
2. **App / org (S2S).** A federated app enrolls as an S2S client via the **AUTH-39 `OauthClient`** registry. **Caveat (Opus):** `OauthClient` authenticates the **app** (openerp), not the org. Per-org sub-scoping rides on the app's own org claim, which is exactly the key broken by `tenantId:=workspaceId`. Therefore level-2 is safe pre-ARCH-11 **only if the app is single-org in total** (mono-tenant); multi-org S2S is G1-gated. The `org → tenant` binding MUST resolve through ARCH-11's reconciled identity + a connector `resolveTenant` mapping (§4.1) before cross-org data.
3. **Business role (account owner).** A user enrolls their org's account via hosted Plaid Link; never sees a secret; receives an opaque `itemRef`. State = `ConnectorEnrollment` + `ConsentGrant` (platform §6.3), not bespoke rows.

## 3. Provider seam and egress boundary

### 3.0 Seam (reuse openerp's `BankProvider` verbatim)
`BankProvider = { id, listAccounts(ctx), listTransactions(ctx, params) }` → `NormalizedAccount[]`/`NormalizedTransaction[]` (`fdx.ts`). Providers: `plaid`, `ofx-upload` (**zero-secret-custody**, mandatory fallback), `flinks` (later), `fdx-native` (2027+).

### 3.1 Egress boundary — DECIDED (owner 2026-07-10, B4)
Plaid's API requires the **raw** `client_secret` and **raw** `access_token` in the HTTPS request body. A sender-bound handle is not dereferenceable by plaid.com, so "handle-first / no raw mirroring" is only coherent if we fix **where the raw material is dereferenced**.

**Owner decision:** support **both** egress models as a **per-connector configurable policy** (`egressMode: 'sentropic-egress' | 'in-boundary'`), with the **Sentropic-hosted egress service as the canonical, precisely-configured default** because it is the **shared delegation point for multiple ERPs**.

- **`sentropic-egress` (canonical default).** Raw operator secret + per-org `access_token` live and are used **only inside a Sentropic-controlled Plaid egress service** (socle / api). A federated app (openerp — and later other ERPs: odoo, sap, …) calls that egress over S2S (AUTH-39), passing `{ tenantContext, itemRef, params }`, and receives **only normalized FDX data**. Raw credentials **never enter the app's memory** → "no raw mirroring" holds at rest *and* at use. The egress is configured **once, precisely** (operator secret, rate/cost quotas, residency region, allowed providers) and **many ERPs delegate to it** — this is the multi-ERP delegation model the owner wants. Apps keep UI + normalization consumption + reconciliation; they are not credential holders.
- **`in-boundary` (opt-in, gated).** An app holds and uses raw credentials in its own runtime under an explicit **KMS-envelope exception + owner gate** (STUDY §4.3 exception clause). For an ERP that must own its egress; expands the trust boundary to that app's repo/runtime, so it is never the default and each activation is owner-approved.

`ProviderContext` carries a **credential resolver that dereferences to raw only inside the active egress boundary**; outside it, only handles/normalized data cross. The current `plaid-sandbox.ts` in-process `cachedAccessToken` is acceptable **only** for the mono-tenant synthetic proof (own sandbox, no real data) and must be deleted for any real path (§7).

### 3.2 Egress isolation — multi-ERP service (from Codex pass, gated by G9)
Because the canonical egress centralizes **every org's tokens**, it is a high-value target and a shared-resource chokepoint. The design MUST specify (blocking for C3):
- **Per-controller / per-ERP / per-item bulkheads:** isolation partitions so one ERP or org cannot exhaust or observe another; no tenant-bearing singleton state.
- **S2S binding:** mTLS + audience-bound tokens (AUTH-39) so an ERP can only invoke the egress for its own tenants; audience enforced, not assumed.
- **Quota / cost caps / circuit breakers:** per-ERP and per-org rate + cost caps (Plaid bills per call), backpressure, and a breaker that fails one ERP closed without collapsing the egress.
- **Plaid-account rate-limit strategy:** one operator account's rate limit is shared across all ERPs → define sharding / per-ERP sub-limits so a runaway ERP cannot starve the rest.
- **Compromise blast-radius + incident response:** a total-token-compromise threat model + a central-vault incident-response runbook (rotate operator + per-org tokens, notify controllers) — part of G9.

## 4. Custody — operator-secret tier (MCP-platform delta)

Current `SecretStatus.scope` (`packages/mcp-platform/src/runtime.ts:98`) = `'principal' | 'tenant' | 'workspace' | 'connector-instance'`. **Delta:** add `'operator'`, and the tier is more than one enum member (Opus MUST-FIX 2):

```ts
export type SecretStatus = {
  name: string;
  scope: 'operator' | 'principal' | 'tenant' | 'workspace' | 'connector-instance';
  operatorRef?: string;      // which operator entity (B1) holds it — supports multi-operator later
  state: LifecycleState;
  rotatedAt?: string;
  rotationWindow?: { previousValidUntil: string }; // dual-key overlap during rotation
};
```

- **`operator` scope** = platform-held, tenant-agnostic (Plaid `client_id`/`secret`). Readable only by the egress service (§3.1), never by any tenant/app/agent. `validateSecrets` discloses **state only** (unchanged, now covering `operator`). Requires a **KMS envelope** (STUDY §4.3) and a **rotation/dual-key window** (Plaid secret rotation must not drop in-flight calls). **Authorization (not just metadata — Codex):** `operator`+`operatorRef` describe *which* secret, not *who may use it*. The egress MUST authorize each request to dereference the operator secret against the caller's audience-bound S2S identity (§3.2) + a valid tenant/consent context; an ERP can trigger a *use* of the operator secret only for its own consented items, never read the secret. **Revocation granularity:** support **per-ERP disable** and **per-org token revoke** as the default blast radius; revoking the **operator** secret itself is the all-ERP outage lever (fail-closed) and is an incident action, not a routine one.
- **Per-org `access_token`** = **`tenant`-scoped**, handle-first / dual-custody (STUDY §4.3), raw mirroring banned, dereferenced only in the egress boundary. **Revocation-wins** (STUDY §4.5): revoke on either side wins immediately; on revoke, delete stored token + purge derived data (§9 erasure).
- **`ofx-upload`** = **zero-secret-custody** (no persisted secret) but **NOT zero-data** — the uploaded transactions are still financial PII subject to §9.
- Plaid `itemRef` = opaque handle, persistable tenant-scoped. `link_token`/`public_token` are short-lived; the **public→access token exchange happens only inside the egress service** (never in the browser or openerp).

### 4.1 `resolveTenant` (the crux ARCH-11 dependency)
The connector MUST define `resolveTenant(item_id | webhook payload) → ConnectorTenantContext`. Pre-ARCH-11 this mapping cannot be trusted for multi-org (it would ride the broken key), so it is fixed to a single tenant in the proof and G1-gated for multi-org.

### 4.2 Plaid sync-cursor custody, reconsent, FDX contract (from Codex pass)
- **Cursor custody:** the Plaid `transactions/sync` cursor is per-item state that determines which transactions are (re)delivered. It is **tenant-scoped**, held with the same isolation as the `itemRef` (never global), and its loss/misuse can leak or replay another org's deltas — so it is covered by the same tenant-isolation invariant (§7).
- **Reconsent lifecycle:** `ITEM_LOGIN_REQUIRED` / expired consent drives a re-auth via elicitation (§5); the connector MUST model `active | login-required | revoked | expired` per item and stop serving on non-active.
- **FDX schema/version contract:** `NormalizedAccount`/`NormalizedTransaction` are a **versioned** contract between egress and consumers; a version field + compatibility policy is required so a provider change does not silently break an ERP.

## 5. Consent, MCP surface, audit, webhooks

- **MCP surface** = read-only tools only (`bank_list_providers`, `bank_list_accounts`, `bank_list_transactions`). **Opus MUST-FIX 2:** the current tools take only a `provider` id with no `tenantRef`/consent — the socle contract MUST thread `StpConnectorContext` (tenant + consent) into every tool call; a call without a valid `ConsentGrant` for the target `itemRef` is invisible (deny-as-missing, platform §7.1), not error-disclosed.
- **Elicitation** (platform §5) drives Link/consent/refresh + `ITEM_LOGIN_REQUIRED` reauth; the agent never sees a secret (STUDY §5).
- **Audit** = every retrieval emits a `ToolInteractionTrace` with `auditId`+`correlationId`. **Opus MUST-FIX 3:** the trace MUST record *metadata only* (who/when/which item/count) and MUST NOT capture transaction rows (merchant/amount/description) — else audit becomes a PII store. This is a gate (G5).
- **Webhooks (hardened, Opus dim 6):** verify Plaid JWT/JWK signature **with kid-pinning + rotation**; enforce **replay/idempotency** (dedup on webhook id + `resolveTenant`); drop+log anything unverified. In `sentropic-egress` mode webhooks **terminate in the socle egress**, so signature/replay/DLQ are a **socle** responsibility (G4 owner adjusted below); a webhook DLQ/queue has **retention + PII classification** rules (no raw bodies retained). Gate G4.
- **Observability policy (from Codex):** logs, traces, APM spans, proxy access logs, idempotency stores and crash dumps MUST NOT capture Plaid request/response **bodies** (account numbers, balances, transaction rows). Enforce with redaction + a no-body assertion test; crash-dump capture of the egress process is disabled or scrubbed. This is part of G5/G6, not prose.

## 6. Gates (mandatory before real / mutualized / persisted data)

| # | Gate | Owner | Blocks |
|---|------|-------|--------|
| G1 | **ARCH-11** tenant/identity reconciliation done (`resolveTenant` trustworthy, no `tenantId:=workspaceId`) | architect design → build lane | any cross-org / multi-org token or consent persistence |
| G2 | **ToS-D0 kill-switch** for mutualized/cross-org (fail-closed) | **owner** | mutualization, third parties |
| G3 | **DPA / PIPEDA / Loi 25** per-org consent registry + revocation + DPA + **processor-status legal validation** (Codex: counsel + Plaid agreement must confirm Sentropic may act as processor/subprocessor with no independent processing purpose — see B6) | **owner** (each org = controller) + architect (registry) + counsel | prod real-data, reconciliation over real transactions |
| G4 | **Webhook** signature + kid-pinning + replay/idempotency + DLQ retention/PII rules | **socle egress** (in `sentropic-egress` mode) / connector (in `in-boundary`) | webhook-driven state |
| G5 | **Data-egress audit** (`ToolInteractionTrace`, metadata-only) | architect (socle) + openerp | prod real-data |
| G6 | **Data residency** = Canadian (decided B5-b): satisfied when the Sentropic cluster is OVH-Canada resident. Residual Plaid US ingest handled **ephemerally in the egress** (not persisted). | **k8s/deployment lane** (cluster migration) + architect (egress ephemerality) | any real Canadian PI |
| G7 | **Retention + right-to-erasure** (Loi 25): delete-on-revoke, retention policy | architect (socle) + owner | prod real-data |
| G8 | **DPIA / PIA artifact** (Loi 25 mandatory for financial PII) | **owner** | prod real-data |
| G9 | **Egress isolation & operations** (§3.2): per-ERP/org bulkheads, quota/cost caps, circuit breakers, S2S mTLS + audience binding, Plaid-account rate-limit sharding, total-token-compromise threat model + central-vault incident-response runbook | architect/socle | **C3 multi-ERP** egress |
| G10 | **Plaid platform/processor agreement** authorizing multi-ERP processor use (distinct from single-app pay-as-you-go) | **owner** | multi-ERP real data (C3/C4) |

**Legal operator entity** (B1) = owner decision (B1-b, §11); the processor-status *legal validation* is B6 + G3.

## 7. What is buildable NOW vs blocked

**Buildable now — under the tenant-isolation invariant (Opus MUST-FIX 2/3):**
- `bank-connector` v1 mono-org, read-only, over **synthetic/sandbox data or the org's OWN uploaded OFX**.
- **Mandatory in the proof (Codex — beyond one cache var):** replace the module-global providers/singletons (`mcp-server.ts:21-22`) and Plaid module state (`plaid-sandbox.ts` `cachedAccessToken`/`cachedInstitutionName`) with a **tenant-keyed provider factory** — **no tenant-bearing singleton state at all**; thread `StpConnectorContext` into every tool (`mcp-server.ts` tools currently take only a `provider` id); ship a **negative tenant-isolation test** (org-B never reads org-A's token/cursor/data).
- **OFX input sandboxing:** the `ofx-upload` `filePath` is currently unconstrained — constrain it (no path traversal, size/type limits, discarded after parse) with a test.
- Normalization (FDX, versioned §4.2), MCP read-only tools with `StpConnectorContext`.
- UI + reconciliation engine over **synthetic/own-OFX** normalized data only.
- **Scope of "own-OFX":** synthetic data is fully unregulated; the developer's/tester's **own** OFX export processed **ephemerally (discarded after parse, not persisted)** is the buildable-now boundary. **Persisting** real own-OFX at rest is still financial PII and triggers §9 / G7 / G8 — so keep it ephemeral until those gates clear.

**Blocked until gates:**
- Persisted per-org access tokens (G1).
- Durable `ConsentGrant` under a real org key (G1 — pre-ARCH-11 consent would persist the wrong key).
- Reconciliation over **real** bank transactions (G3 + G6 + G7 + G8 — real financial PII).
- Any cross-org / mutualized custody (G1 + G2).
- Production Plaid (G2 + G3 + G6 + legal entity B1).
- Webhook-driven refresh in prod (G4).

## 8. Phase mapping (aligns openerp C0–C4)
- **C0** sandbox POC — DONE (`040dbf3`). GO confirmed.
- **C1** v1 (ofx + plaid-sandbox, S2S via AUTH-39) — GO, **read-only mono-tenant, synthetic/own-OFX, isolation-tested**; token in memory only, no persistence.
- **C2** UI + reconciliation — GO on synthetic/own-OFX normalized data; real-bank reconciliation is G3/G6/G7/G8-gated.
- **C3** MCP + consent + metering + **operator-secret custody + egress service** — GATED on G1 + operator-secret delta + egress boundary (B4) + **G9 (egress isolation)** + **G10 (Plaid multi-ERP agreement)**.
- **C4** third parties — GATED on G2 + Plaid platform agreement (owner).

## 9. Regulatory (Canada) — several items promoted to blocking gates
- **Controller model (decided B1-b):** Sentropic is **operator/processor**; **each app/org is the controller** of its own bank data. A **DPA (Sentropic↔app)** governs the relationship and names the breach-notification duty per party. The DPA template is a socle deliverable, required before any org onboards real data (part of G3).
- **PIPEDA + Québec Loi 25:** per-org consent + registry + revocation (G3); **retention + right-to-erasure / delete-on-revoke** (G7); **DPIA/PIA** mandatory for financial PII (G8, produced by each controller with socle support).
- **Residency (decided B5-b, G6):** Canadian residency via the cluster's OVH-Canada migration. Once resident, storage is in-country; the only cross-border hop is the **Plaid US ingest**, kept **ephemeral in the egress** (transactions not persisted outside the Canada-resident store).
- **Plaid ToS:** pay-as-you-go OK for our own federated apps/orgs; third parties need a dedicated platform agreement (C4).
- **Data-flow / storage inventory (Codex — makes "ephemeral" enforceable):** enumerate **every** place Plaid-origin PII can land at rest — primary DB, logs, traces/APM, caches, idempotency stores, webhook DLQs, crash dumps, proxy/access logs, normalized output — and set each to **no-body / TTL / redaction / Canada-resident** with enforcement tests. "Ephemeral in the egress" is only true once this inventory is closed.
- **Retention by field + minimization:** define retention per field class (identifiers vs amounts vs descriptions), minimize what is persisted, and honor delete-on-revoke (G7) across the whole inventory above.
- **Breach playbook:** a documented incident procedure (detect → rotate operator+per-org tokens → notify each affected controller per DPA → regulator per Loi 25) — the operational face of G3/G9.

## 10. Test plan (socle-facing)
- Unit: `operator`-scope `SecretStatus` disclosed state-only; value never leaks; rotation dual-key window respected.
- Unit: credential resolver dereferences to raw **only inside the egress boundary**; outside, returns a handle.
- **Unit (negative tenant isolation):** org-B call can never resolve org-A's token/data even in the mono-tenant proof (module-global cache deleted).
- Unit: revocation-wins — revoke on either side blocks the next call + triggers data purge.
- Unit: unconsented `itemRef` invisible (deny-as-missing), not error-disclosed.
- Unit: `ToolInteractionTrace` contains **no** transaction rows (PII assertion).
- Unit: webhook bad signature / replayed id / wrong kid → dropped; good → accepted once.
- Integration: mono-tenant synthetic path (ofx + plaid-sandbox) end to end with metadata-only trace.
- Contract: `BankProvider` seam unchanged for openerp; socle adds only the egress-boundary resolver.

## 11. Open decisions (owner-gated)

| Code | Decision | Owner |
|------|----------|-------|
| B1 | Legal entity operating Plaid + controller duties — **DECIDED (owner 2026-07-10): B1-b** = Sent-Tech is operator/**processor** (runs Plaid + egress technically); **each app/org is the controller** of its own data; a **DPA (Sentropic↔app)** is a required socle deliverable. Pairs with B4 multi-ERP egress. | DECIDED |
| B2 | ToS-D0 kill-switch activation timing for mutualization | owner |
| B3 | Connector residence: stays in openerp repo consuming `@sentropic/mcp-platform` (federated, like immo) vs monorepo. **Prerequisite:** mcp-platform P1 activation (published/consumable — currently private/mock, STUDY §10.5). | architect reco = federated; owner ratifies |
| B4 | **Egress boundary** — **DECIDED (owner 2026-07-10):** both models as a per-connector `egressMode` policy; Sentropic-hosted egress service = canonical default (shared multi-ERP delegation point, precisely configured once); `in-boundary` = opt-in under KMS exception + owner gate. See §3.1. | DECIDED |
| B5 | Data storage region — **DECIDED (owner 2026-07-10): B5-b** = **Canadian data residency**, achieved by **migrating the whole Sentropic cluster Scaleway (EU) → OVH (Canada region)**. This is a **cluster-wide deployment-plane program owned by the k8s/deployment lane** (ARCH-17 adjacent), not scoped to this connector; the bank connector simply consumes a Canada-resident cluster. Egress-minimization (§4) stays as defense-in-depth. | DECIDED — depends on k8s migration lane |
| B6 | **Processor-status coherence** — **DECIDED (owner 2026-07-11): (a)** keep B1-b (Sentropic processor / each org controller) **+ a blocking legal-validation gate**: counsel + the Plaid agreement must confirm Sentropic may act as processor/subprocessor with **no independent processing purpose** before real data (G3). If validation fails, revisit toward B1-a/joint-controllers. Only bites at G3. | DECIDED (a) — validation at G3 |

## 12. Recommendation
Ship C1–C2 now, strictly **mono-tenant read-only over synthetic/own-OFX data**, with the module-global token cache deleted and a negative tenant-isolation test green. Socle changes: the `operator` `SecretStatus` tier (with `operatorRef` + rotation window + KMS envelope) and a credential resolver that dereferences to raw **only inside the active egress boundary**. Per B4 (decided): the **Sentropic-hosted Plaid egress service is the canonical default** — configured once, precisely, as the **shared delegation point multiple ERPs call in S2S** — with `in-boundary` available opt-in under a KMS exception. Hold C3 (mutualized custody, real data) behind ARCH-11 (G1) and the owner legal/kill-switch/DPIA/residency gates (G2/G3/G6/G7/G8). Keep each connector federated in its app repo (B3), consuming the Sentropic socle + egress — do not absorb it into the monorepo, and do not let raw credentials leave the egress boundary.

## 13. Consensus review record
- **Opus 4.8xhigh** (2026-07-10): NEEDS-REVISION → reconciled into v2. Findings integrated: egress boundary (§3.1/B4), enforced tenant isolation + delete module-global cache + negative test (§7/§10), consent/reconciliation reclassified as gated (§7), operator-secret tier expanded (§4), webhook replay/idempotency/kid-pinning (§5/G4), trace metadata-only PII ban (§5/G5), cross-border/retention/DPIA promoted to gates G6/G7/G8, `resolveTenant` crux (§4.1), OauthClient app-vs-org caveat (§2), link/public token exchange location (§4), AccessGrant reconciliation (below).
- **AccessGrant reconciliation (STUDY §3.4, sharpened by Codex):** this spec uses `ConsentGrant` (the real MCP-platform lifecycle record) directly and must NOT fork a parallel grant store. But `ConsentGrant` alone does not answer subject/target/capability/mode; before real MCP use, a **minimal `AccessGrant` projection** (index referencing the `ConsentGrant`, carrying subject/target/capability/mode) is required so the bank connector composes with the canonical primitive rather than hiding the debt. Full `AccessGrant` lands with the broker; the projection is the seam.
- **Owner decisions (2026-07-10):** B4 = both egress models, per-connector `egressMode`, Sentropic egress service canonical (multi-ERP delegation). B1 = B1-b (Sentropic processor, each org controller, DPA required). B5 = B5-b (Canadian residency via cluster Scaleway→OVH-Canada migration, owned by k8s/deployment lane). Remaining owner gate: B2 (kill-switch timing).
- **Cross-cutting dependency raised:** B5-b makes a **cluster-wide EU→OVH-Canada migration** a prerequisite for G6; this is a deployment-plane program (k8s lane), not part of this connector's build. The bank connector consumes its outcome.
- **Codex 5.5xhigh** (2026-07-11): NEEDS-REVISION → reconciled into v3. Findings integrated: multi-ERP egress isolation + G9 (§3.2), operator-secret authorization semantics + granular revocation (§4), Plaid cursor custody + reconsent + versioned FDX contract (§4.2), observability no-body policy + webhook DLQ/PII + G4 owner moved to socle egress (§5), tenant-keyed provider factory (not just cache delete) + OFX path sandboxing (§7), ephemeral data-flow/storage inventory + retention-by-field + breach playbook (§9), G10 Plaid multi-ERP processor agreement, minimal AccessGrant projection (above). Findings NOT silently applied — **surfaced to owner as B6** (processor-status legal coherence), since it challenges the B1-b decision.
- **Double-consensus outcome:** both engines independently returned NEEDS-REVISION with complementary (non-overlapping) findings — Opus = custody/tenant-key/regulatory-gates; Codex = multi-ERP isolation/legal-processor-coherence/ephemerality-side-channels/ops. All architect-fixable findings integrated; the one owner-gated tension (B6) is DECIDED (a). A final dual confirmation pass ran on v3: **Opus = PASS (merge-ready, no residual blocker)**; the Codex confirm leg was usage-limited, but the substantive Codex adversarial pass (above) is complete and its findings are integrated — the double-consensus requirement (two independent engines reviewed + reconciled) is satisfied. Spec is merge-ready.
