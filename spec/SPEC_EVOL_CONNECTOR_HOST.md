# SPEC_EVOL — Connector Host (durable app-side mount for third-party MCP connectors)

- **Status**: DRAFT / ACTIVATION — awaiting architect double-review (`claude:architect:4f23dcc39369`)
- **Date**: 2026-07-31
- **Lane**: `claude:mcp` (integration lane — owns third-party tool integrations), build+merge; architect frames the contract + double-reviews.
- **Lineage / activates** (this spec introduces NO new architecture; it ACTIVATES ratified prior art):
  - `SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` — `@sentropic/mcp-platform` 0.1.0 contract + tiers (BR-42l / WP-CATALOG).
  - `SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` — FROZEN broker reference (AccessGrant = policy/index, handle-first custody).
  - `SPEC_EVOL_CONNECTOR_ACCOUNT_WORKSPACE_EXPOSURE.md` — enrollment vs exposure, the six deny-by-default invariants, ownership routing.
  - `SPEC_EVOL_SECRET_KEY_SEPARATION.md` — three-key boundary, `enc:v1:`/`enc:v2:` versioned envelope + typed credential-envelope error.
  - `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`, `SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md` (Drive bespoke = debt to retire).

> **Single-source-of-truth rule for this spec.** Every interface/record already named in the specs above is REUSED verbatim (see §1). The names this spec introduces (`ConnectorHost`, the secret-port two-code mapping, the account resolver, the Gmail connection) are NEW seams that no prior spec owns — they are proposed here for architect ratification, not asserted as decided.

---

## §0 — Goal & scope

Make Gmail (and Google Drive) read-only tools **usable end-to-end via MCP+h2a**, per workspace, by building the **durable app-side host** that `@sentropic/mcp-platform` deliberately leaves to the app: an adapter mount + injected resolvers/secret port, exposed to the app behind **one per-workspace deny-by-default entry**.

- **Reusable, capitalizable.** The host is the integration lane's capitalizable layer for **all** third-party tool integrations — not app-local glue and not Google-specific. Google is its first consumer.
- **Durable path only.** No bespoke second connector, even labeled debt. Gmail is a **greenfield consumer of the host** (no bespoke Gmail ever). The ~1460-line Drive bespoke becomes **debt to retire onto this host** (follow-up lot); the host is built to serve Drive too.
- **Separate Gmail connection.** `gmail.readonly` on the **same Google OAuth client** but a **distinct connector-account** (`provider='gmail'`), so existing Drive grants are untouched and no Drive re-consent is forced (§6).

**In scope**: the host package + its ports, the Gmail connection, and the P1 read-only proof (§7). **Out of scope** (reuse the ratified gates, §11): AccessGrant storage, a product registry, h2a↔Sentropic sync, cross-workspace exposure, raw-secret mirroring, and any durable multi-tenant persistence that ARCH-11 gates (§7 P2).

---

## §1 — Names REUSED from ratified specs (do not fork)

| Concept | Reused name / seam | Source |
|---|---|---|
| Platform package | `@sentropic/mcp-platform` (0.1.0, public; do NOT create a competing package) | ACTIVATION §0 |
| Adapter contract | `AppConnectorProviderAdapter` (Drive + Gmail already exist as instances in `@sentropic/mcp-connector-google` on main) | APP_MCP §4.4 |
| Per-invocation context | `StpConnectorContext` w/ audited `getSecret(name): Promise<string>` (NAME-only, per-call, no bulk map) | APP_MCP §4.5 |
| Tenant resolution | adapter `resolveTenant(...)` (narrow-only) + core `TenantResolver.authorizedTenants(principalSub, connectorInstanceId)` | authz.ts:61; ARCH-11 §2.1 |
| Manifest / capability | `AppMcpProviderManifest`, `AppCapability`, `CapabilityTool/Resource`, `Mutability`, `CapabilityGates` | ACTIVATION §3.1 |
| Deny-as-missing visibility | `ConnectorVisibilityState`, `VisibilityContext`, `listVisibleCapabilities` | visibility.ts |
| Account / exposure records | `ConnectorAccountEnrollment { id, connectorId, principalSub, tenantRef, accountRef, secretRefs[], state }`, `WorkspaceConnectorExposure { id, enrollmentRef, tenantRef, workspaceRef, capabilityIds[], state }` | WORKSPACE_EXPOSURE §3 |
| Deny-by-default model | the six invariants (server-side principal/tenant/workspace resolution; selector hints narrow-only; missing/ambiguous/mismatch → deny-as-missing; secrets never in h2a/prompts/args/logs; no inbound-token passthrough) | WORKSPACE_EXPOSURE §2 |
| Secret at rest | `document_connector_accounts.token_secret`, `enc:v1:`/`enc:v2:` versioned envelope + typed credential-envelope error raised in `secret-crypto.ts` | SECRET_KEY_SEPARATION D6/D7 |
| Secret requirement scope | `ConnectorSecretRequirement.scope` incl. `'operator'`; `SecretStatus`/`validateSecrets` (state-only, fail-closed) | ACTIVATION §4 |
| Opaque-ref forward hinge | `enrollmentRef`, `consentRefs`, `grantRefs`, `connectorInstanceId`, `mandateRef` (never import a grant type) | ACTIVATION §8 |
| Registration seam | `defineStpMcpConnector(...)` | APP_MCP §7 |

---

## §2 — The activation gap (decided, but no code realizes it)

1. **No real host** mounts adapters behind the runtime. `@sentropic/mcp-platform` is contract + test-only mocks ("In-memory mocks are a test harness only"). api does **not import** `@sentropic/mcp-platform` at all. `api/src/routes/api/mcp.ts` `/invoke` is a claims-echo stub, gated OFF.
2. **No `account → connectorInstanceId` resolver.** `account_subject` is a bespoke Drive column; the generic record is `ConnectorAccountEnrollment`, but nothing resolves it to a mounted instance.
3. **No host secret port + no two-code mapping.** `resolveGoogleDriveTokenSecret` collapses every failure to `null` (and can leak a raw throw — `decryptSecretOrNull` sits outside its try/catch). `SecretEnvelopeError` and the two connector-facing codes do not exist.
4. **No adapter registry / single per-workspace deny-by-default mount** as a host abstraction (deny-by-default exists only as a *semantic* + the visibility helper).
5. **No provider-generic OAuth + no Gmail connection.** OAuth is Drive-specific (`drive.file`); a `gmail.readonly` connection is net-new and unowned.

---

## §3 — The new host: `@sentropic/connector-host` (proposed)

A published package that **consumes** `@sentropic/mcp-platform` and provides the **real host** the platform's docs say the app must implement. It is the integration lane's capitalizable layer.

**Ownership routing** (reconciles WORKSPACE_EXPOSURE §6):
- **mcp-platform** keeps: the frozen contract, manifest mediation, deny-as-missing, opaque-ref threading. No DB/KMS/h2a.
- **`connector-host` (this package, my lane)** owns: the **adapter registry**, the **single per-workspace deny-by-default mount**, and the **injected host-port interfaces** (§4) — but only the *interfaces + a pure orchestration*, no direct DB/KMS import.
- **api / socle** owns: the concrete port *implementations* (DB-backed enrollment/exposure lookups, the secret egress via `secret-crypto`/`resolveGoogleDriveTokenSecret`, the OAuth flows). The host receives these by injection, so the package stays dependency-free of app internals.

> Rationale for a NEW package (not app-local, not inside mcp-platform): the owner assigns the integration lane ALL third-party integrations; the host must be reusable across connectors and testable in isolation. It cannot live inside mcp-platform (which forbids DB/KMS/registry ownership) nor be app-local glue (would not capitalize). Registry residence was explicitly *parked* in the broker study — this spec un-parks the **mount/registry** (not a product registry) as the integration lane's asset.

---

## §4 — Host-port interfaces (new seams — for architect ratification)

Injected into the mount; implemented by api/socle. All values are opaque refs or state; **no raw secret crosses a port boundary except `getSecret`'s per-call return, inside the egress boundary.**

1. **Secret port** — implements `StpConnectorContext.getSecret(name)`. Resolves the per-account token and maps failures into the **two-code connector contract** (§8). It wraps `resolveGoogleDriveTokenSecret`-style resolution (decrypt + refresh) per provider; it never logs the token.
2. **Account resolver** — `resolve(principalSub, connectorId, workspaceRef, accountSelectorHint?) → { connectorInstanceId, enrollmentRef, secretRefs[] } | deny`. Backed by `document_connector_accounts` / `ConnectorAccountEnrollment`; **one `connectorInstanceId` per distinct `account_subject`** (aligned to migration 0040's UNIQUE `(workspace_id,user_id,provider,account_subject)`). Multi-account ambiguity → deny-as-missing → durable elicitation (never model-selected).
3. **Tenant/exposure resolver** — reuses `TenantResolver.authorizedTenants` + adapter `resolveTenant` (narrow-only), plus an **active `WorkspaceConnectorExposure` binding** check. Server-side resolution of principal/tenant/workspace; client/model/upstream values are selector hints only.
4. **Audit port** — the platform's audit sink seam (name-only secret audit, state-only status).

---

## §5 — The single per-workspace deny-by-default mount

`mountConnectorHost({ adapters, ports, exposurePolicy })` → a servable surface driving, per request: resolve principal/tenant/workspace server-side → check active exposure binding + finite `capabilityIds[]` allowlist → `resolveTenant` (narrow-only) → `invokeTool`/`readResource` with a real `StpConnectorContext` built from the ports. Enforces the **six invariants** (§1). Capability discovery uses `listVisibleCapabilities` (deny-as-missing). **Allowlist is explicit; nothing is allowed by omission.** Adapters register via `defineStpMcpConnector`.

---

## §6 — Separate Gmail connection (`gmail.readonly`)

- **Scope**: `https://www.googleapis.com/auth/gmail.readonly`, requested on the **same Google OAuth client** as Drive (additive scope on the client, but a **separate authorization + separate connector-account row**, `provider='gmail'`). This does **not** modify or re-consent the Drive grant (`drive.file`).
- **Storage**: reuses `document_connector_accounts` (migration 0040 already allows `provider='gmail'` + `account_subject`). Token material encrypted via the ratified envelope.
- **OAuth layer**: the Drive OAuth service is Drive-specific and unowned for multi-provider. This spec proposes a **provider-parametrized OAuth flow** owned by the integration lane (start/callback keyed by provider + scope set), so Gmail does not clone the bespoke. Minimal for P1: a Gmail start/callback that reuses the Drive OAuth mechanics generically (state HMAC, code exchange, identity resolution) parameterized by scope+provider.
- **Adapter**: `gmailLiveAdapter` (already on main) mounts through the host §5. Token reaches it only via `ctx.getSecret`.

---

## §7 — SEQUENCING: P1 (now) vs P2 (gated on ARCH-11 / #439)

This is the load-bearing decision. WORKSPACE_EXPOSURE §5 makes durable multi-tenant/workspace persistence **NO-GO until ARCH-11 strict tenant resolution is in place** (DB-backed EnrollmentStore, all pods rolled, divergence zero). **ARCH-11 is #439 — still OPEN.**

- **P1 — shippable NOW (no ARCH-11 dependency):** the `connector-host` package + mount + injected ports; the Gmail `gmail.readonly` connection; **single-principal, read-only** end-to-end proof with **in-memory / api-session-backed (non-production-persistence) resolvers**, opaque-ref contracts, deny-as-missing. Gmail read-only usable for the owner's own principal. This is the UAT target.
- **P2 — GATED on #439 (ARCH-11 strict):** DB-backed `EnrollmentStore` + durable `WorkspaceConnectorExposure` persistence, multi-workspace exposure, cross-principal. NO-GO until #439 lands strict + divergence zero.
- **Drive-bespoke retirement** — follow-up lot after P1 proves the host: migrate the ~1460-line Drive bespoke onto `connector-host`, delete the bespoke.

**Consequence for the owner**: fully-durable multi-workspace Gmail is **downstream of #439**. The near-term deliverable is the durable-*shaped* P1 read-only proof on the reusable host (no bespoke), which becomes multi-workspace by flipping P2 on once ARCH-11 is strict — not by a rewrite.

---

## §8 — Two-code secret contract (the new seam I own)

The connector adapter already emits (shipped in #465): `connector_secret_unavailable` (retriable **false** — absent / not enrolled; user must connect) and `connector_secret_unreadable` (retriable **true** — undecryptable / mid key-rotation; a correct deploy repairs it, no user action). The host secret port MUST feed those two conditions in, consistently with SECRET_KEY_SEPARATION layering:
- **unreadable** ← the typed credential-envelope error raised inside `secret-crypto.ts` (unknown version / malformed / GCM-tag fail). Proposed type name: `SecretEnvelopeError` (kept in `secret-crypto.ts`, carrying safe `reason`/`version` only — never the value).
- **unavailable** ← `SecretStatus` missing / non-`active`, or account-resolution deny.
- **Anything else (TypeError / programming error) propagates** — the envelope refuses what it doesn't understand.
- **No destructive action** on either code (no token erase, no account-dead marking) — the fix that #463 landed one layer up.

---

## §9 — Open questions for architect double-review

- **OQ1 — Package name/residence.** `@sentropic/connector-host` as proposed, or fold the mount into an existing package? (Must not be app-local, must not fork mcp-platform.)
- **OQ2 — OIDC verifier for P1.** WORKSPACE_EXPOSURE requires server-side principal resolution; for a single-principal read-only P1, may we resolve principal from the **existing api session** (not the full RFC 8707/9728 audience-bound verifier, which is AS-side-gated)? Or is even P1 gated on the real verifier?
- **OQ3 — Two-code seam placement.** Confirm the mapping lives in the host secret port (§8), that `SecretEnvelopeError` is introduced in `secret-crypto.ts`, and that this does not front-run the SECRET_KEY_SEPARATION remediation.
- **OQ4 — Provider-generic OAuth ownership.** The integration lane proposes owning a provider-parametrized OAuth layer (§6). Confirm, vs a per-connector bespoke flow the specs assign to "connector owners."
- **OQ5 — account_subject vs `ConnectorAccountEnrollment`.** Reconcile the Drive-bespoke `account_subject` with the generic enrollment record for the account resolver (§4.2) — which is canonical for P1?

---

## §10 — Lots (build) with P1/P2 gating

| Lot | Deliverable | Phase |
|---|---|---|
| **L0** | This spec — architect double-review | — |
| **L1** | `@sentropic/connector-host` package: host-port interfaces + mount (drives adapters via real `StpConnectorContext`, deny-by-default), hermetic tests (mount Drive+Gmail with mock ports, 2 codes, no-leak, deny-as-missing). No app coupling. | P1 |
| **L2** | api port implementations + single mount: secret port (2-code mapping via `resolveGoogleDriveTokenSecret`), account resolver, session-backed principal/tenant/workspace, exposure check (in-memory/non-prod). | P1 |
| **L3** | Gmail `gmail.readonly` separate connection: provider-parametrized OAuth start/callback, `provider='gmail'` connector-account, encrypted token. | P1 |
| **L4** | Gmail end-to-end activation via the host; serve over the app MCP/h2a surface (single-principal); hermetic e2e + opt-in live smoke (owner's real `gmail.readonly` token). → **Gmail usable end-to-end (P1).** | P1 |
| **L5** | Retire Drive bespoke onto `connector-host`; delete the ~1460-line bespoke. | P1 (follow-up) |
| **L6** | DB-backed enrollment/exposure persistence + multi-workspace. | **P2 — gated on #439 (ARCH-11)** |

---

## §11 — Non-goals (reuse the ratified gates)

No `AccessGrant` storage/schema (policy/index only, future); no product registry / stable connector-ID catalog / credential custody; no h2a↔Sentropic sync; no cross-workspace exposure; no raw-secret mirroring (handle-first); no inbound-token passthrough; no durable multi-tenant persistence before ARCH-11 strict. The host threads opaque refs so `AccessGrant` can later point at them without a rewrite.
