# SPEC STUDY — Universal Connector & Account Broker

Status: **FROZEN / CONSOLIDATED (2026-07-11)** — this study is now the **locked reference** for the Universal Connector & Account Broker. Its owner decisions are ratified and no longer churn here; new work spawns dedicated `SPEC_EVOL_*` documents, not edits to this study.
- **First derived EVOL:** `spec/SPEC_EVOL_BANK_CONNECTOR.md` (bank/financial connector — double-consensus Opus 4.8xhigh + Codex 5.5xhigh, owner-ratified B1-b/B4/B5-b/B6-a, merged in PR #396). It instantiates the broker pattern with the `operator`-secret custody tier + the multi-ERP egress model.
- **Remaining foundations** (ARCH-11 tenant reconciliation, the canonical `AccessGrant` primitive, h2a↔Sentropic sync, P5 registry residence) stay tracked as their **own workstreams** — this study records them as open (§2/§3/§10), it is not re-opened to resolve them.
Review state: Codex adversarial review reconciled (NEEDS-REVISION → incorporated). Opus re-run remains due only at the irreversible EVOL/API-freeze gate of each derived EVOL (the bank EVOL cleared that gate with a full double-consensus).
Owner decisions incorporated (2026-07-06): AccessGrant=policy/index referencing lifecycle records; handle-first custody with raw-secret mirroring banned by default; allow early same-human h2a-local descriptor/human-mediated subset; catalog wave = Wave(read-only) → npm → GitHub/Google → cloud/FinOps.
Owner intent: make Sentropic + h2a a universal, secure broker for connectors and accounts across all CLIs and agents.
Sequencing choice: **Foundation-first** (owner-selected). We prioritize the stable tenant/authz foundations before cross-agent/cross-user/workspace-atom rollout; reversible mono-user catalog work may proceed in parallel.

## 0. Executive summary

The desired product is a **universal connector and account broker**:

- one registry/catalog for MCP connectors and account-backed capabilities;
- usable from Sentropic UI, h2a MCP, Claude Code, Codex, agy/Antigravity and future CLIs;
- supporting both local enrollment via h2a and remote enrollment on `sentropic.sent-tech.ca`;
- synchronizing local and remote enrollment transparently when the user opts into Sentropic;
- governing who may manage and invoke each connector/account at workspace granularity;
- covering MCP connectors (GDrive, Gmail, WhatsApp, LinkedIn, Wave, SharePoint, GitHub, Notion, HubSpot, Slack, ClickUp, HuggingFace, cloud CLIs, Salesforce, SAP, ENOVIA, Apriso, Odoo/OpenERP, NewRelic, etc.) and LLM/account credentials (Claude Code, Codex, npm, cloud accounts, etc.);
- handling 2FA/security-key challenges through Sentropic/h2a human escalation surfaces, not by exposing secrets to agents.

Grounding shows this is **not a greenfield system**. The existing specs already define most atoms:

- MCP platform: `AppMcpProviderManifest`, `AppConnectorProviderAdapter`, `StpConnectorContext`, `McpSession`, `ConsentGrant`, `ConnectorEnrollment`, elicitation state machine.
- Resource plane: `ResourceRef`, `ScopeMap`, deny-as-missing, `discover/read/invoke`, `ToolInteractionTrace`.
- Tenancy/data: `TenantContext`, `tenant_memberships`, `ScopeMap`, `EventEnvelope`.
- LLM gateway/mesh: `SecretAuthMaterial`, `AuthorizationGrant`, account transport acquisition.
- h2a: signed local actor identity, sessions/inbox/negotiations, `ActClaim.h2a_eng` bridge.

But the vision depends on three foundations that are not yet complete:

1. **ARCH-11 tenant reconciliation** — today `tenantId := workspaceId` remains live in prod in places, while identity-tenants and product workspaces are converging but not reconciled.
2. **A canonical authorization primitive** — `ConsentGrant`, memory-only `resource_grants`, Resource-Plane `discover/read/invoke`, LLM `AuthorizationGrant`, and h2a `ActClaim.h2a_eng` are currently separate planes.
3. **A local-h2a ↔ Sentropic sync protocol** — h2a currently has a local file registry for agents; it does not yet have connector/account enrollment, remote sync, or connector capabilities.

Because the owner chose **Foundation-first**, this study recommends the following posture:

- **P0 — freeze foundations before irreversible cross-agent/cross-user semantics**: write ARCH-11 and define the canonical grant primitive.
- **P1 — activate `@sentropic/mcp-platform` as the broker-aware public contract**: publish only a surface compatible with the future broker, not a Wave-only adapter slice.
- **P2 — build a mono-principal connector/account catalog** using the same types, without promising cross-user/cross-agent sharing yet.
- **P3 — define and implement h2a↔Sentropic sync** after the grant primitive is stable.
- **P4 — expand to workspace-atom sharing, external agents, and large catalog rollout** after ARCH-11/39h/ARCH-14 gates are satisfied.

## 1. Goal and non-goals

### 1.1 Goal

Provide a single control plane where a principal can:

1. enroll a connector or account locally via h2a, remotely via Sentropic, or both;
2. see the same enrollment state across local CLIs and Sentropic UI;
3. grant or revoke access at the atom of workspace / connector / capability / subject / agent;
4. use those connectors from Claude Code, Codex, agy, h2a-powered tools, Sentropic UI, and future agents;
5. complete 2FA/security-key challenges through a human escalation surface;
6. audit all connector/account use with resource-level traces.

### 1.2 Non-goals for v0

- No blind import of secrets from arbitrary local CLI config without explicit principal action.
- No agent-visible 2FA codes, refresh tokens, session cookies, or private keys.
- No cross-user/cross-agent sharing before the canonical grant primitive and tenant model are stable.
- No registry package publication before real consumer boundaries are proven. `mcp-registry` residence remains a design decision, not assumed.
- No attempt to implement every connector in the first wave; the catalog needs a repeatable adapter/enrollment pattern first.

## 2. Grounded decided-vs-open map

### 2.1 MCP provider platform / mcp-auth / mcp-registry

Decided:

- `AppMcpProviderManifest` and `AppConnectorProviderAdapter` define the connector/provider contract.
- `surface` and `mcpClient` are distinct axes: UI/host parity vs client authz.
- `StpConnectorContext` is the per-invocation envelope containing `principal.sub`, `tenantRef`, `workspaceRef`, `connectorInstanceId`, `consentRefs`, `grantRefs`, and audited `getSecret(name)`.
- `McpSession`, `ConsentGrant`, and `ConnectorEnrollment` are the lifecycle records for sessions, consent and enrollment.
- `ConnectorVisibilityState` plus deny-as-missing gives the visibility model.
- Elicitation has a state machine suitable for 2FA/security-key escalation: `requested → rendered → answered → validated → resumed`, terminals deny, anti-phishing checks, NHI never auto-satisfies.
- Inbound MCP tokens are never passed through to downstream SaaS; connectors use core-managed credentials.

Open:

- P5 registry residence is parked: API control-plane vs Resource-Plane package vs published package.
- `mcp-registry` is not built as a product registry: no tenant catalog, no stable connector IDs, no credential custody, no attestation at register.
- MCP authz gaps remain: RFC 9728 PRM / RFC 8707 user-flow / challenges / DCR-related paths are not fully live.
- Connector catalog shape is not specified beyond the manifest/adapter contract.

Broker implication:

- `McpSession` / `ConsentGrant` / `ConnectorEnrollment` are the starting tables for enrollment, but they must be extended or composed with the canonical grant primitive.

### 2.2 Personal Hub / neutral space

Decided in memory but not committed as spec:

- `PrincipalScope` should be user-direct, not a personal tenant.
- `resource_grants` is intended as the γ authorization primitive.
- Cross-user/distribution is gated by ARCH-11 and ARCH-14.

Open:

- No `SPEC_EVOL_PERSONAL_HUB.md` exists.
- `resource_grants` has no type, table, schema, API, or relation to `ConsentGrant` / `AuthorizationGrant`.
- Multi-account management, delegation, per-user inventory and cross-project cockpit are not specified.

Broker implication:

- The broker should probably make the memory-only `resource_grants` concept real, but must decide whether it **is** the canonical grant primitive or a projection of one.

### 2.3 Resource Plane / ARCH-21

Decided:

- `ResourceRef { provider, scope: ScopeMap, type, id, etag? }` and `res://` are the canonical resource identity form.
- Authorization projects as `discover/read/invoke`, with deny-as-missing.
- `invoke` is distinct from write.
- MCP resources preserve upstream URI identity where allowed.
- `ToolInteractionTrace` records touched refs, etags and provenance.

Open:

- Authz-projected namespace is not implemented; current catalog listing is not scoped.
- `ResourceProvider` as a mount provider does not yet exist.
- MCP ID stability is not solved.
- `resource_grants` is not part of this spec.

Broker implication:

- The broker catalog should expose connector content as Resource-Plane resources and enforce `discover/read/invoke` through grants.

### 2.4 Data & tenancy architecture

Decided:

- Tenant means org/account; workspaces are below tenant.
- IdP owns identity-tenant membership; product owns resource bindings.
- `TenantContext`, `AuthzContext`, `ScopeMap`, `IdempotencyKey`, `EventEnvelope` are the published atoms.
- `tenants` and `tenant_memberships` are live.

Open:

- ARCH-11 tenant reconciliation remains the critical blocker: existing prod code still has workspace-as-tenant aliasing.
- Service/NHI tokens do not yet reliably carry `tid` for multi-tenant MCP segregation.
- ARCH-14 event spine/outbox is not implemented.

Broker implication:

- Workspace-atom connector/account grants require a stable tenant/workspace model. This is why the selected sequence is Foundation-first.

### 2.5 LLM gateway / LLM mesh

Decided:

- LLM accounts are represented as typed `SecretAuthMaterial` variants, including Claude Code and Codex account material.
- Personal passthrough v0 is ToS-safe: callers only use their own accounts by default.
- Cross-user pooling requires explicit owner ToS acceptance plus kill-switch.
- Cross-user authz has a 3-mode `AuthorizationGrant`: `direct-authorization`, `explicit-validation`, `assisted-mode`.
- Account transport acquisition is mediated and metered.

Open:

- Gateway runtime is not yet fully functional; local server placeholder still throws.
- Cross-user authz is not active.
- Storage and relation of `AuthorizationGrant` to workspace/resource grants is unspecified.
- No local↔Sentropic account sync exists.

Broker implication:

- The LLM-account model is a strong precedent for all account-backed capabilities, including npm, cloud CLIs and SaaS APIs. The 3-mode authorization vocabulary should either become part of the canonical grant primitive or be derived from it.

### 2.6 h2a plugin system

Decided:

- h2a is a local filesystem-bus for multi-CLI coordination: inbox/outbox/registry/presence/negotiations/keys.
- Registry records agent instances with roles/scopes/endpoints/public keys.
- h2a MCP exposes coordination operations over the same local store.
- h2a installs skills into supported CLIs.
- `ActClaim.h2a_eng` is the only current h2a↔auth bridge and must remain opaque to IdP.

Open:

- No connector/account enrollment exists in h2a.
- No local↔Sentropic sync protocol exists.
- h2a registry has `capabilities: []` and only local-file endpoints today.
- h2a is not a network MCP bus.
- No workspace-atom authz exists in h2a scopes.

Broker implication:

- h2a must gain connector/account capability declarations and a sync protocol, but the trust semantics should remain h2a-native; Sentropic should validate signatures/engagement references without interpreting h2a mandates beyond policy presence checks.

## 3. Central design problem: canonical grant primitive

Today there are five authorization planes:

1. MCP `ConsentGrant`: principal consent to a connector/client/session.
2. Personal Hub `resource_grants`: intended γ primitive, not yet typed.
3. Resource Plane `discover/read/invoke`: capability projection and deny-as-missing.
4. LLM Gateway `AuthorizationGrant`: 3-mode account use authorization.
5. h2a `ActClaim.h2a_eng`: signed engagement/mandate reference for agent action.

The broker needs a single canonical grant model that can answer:

- Who owns or enrolled this connector/account?
- Who may manage it?
- Who may discover it?
- Who may read/list resources through it?
- Who may invoke tools/actions through it?
- Which agent identity is acting, on whose behalf, under which h2a engagement?
- Is this direct authorization, explicit validation, or assisted mode?
- Does the grant require human challenge/2FA at use time or enrollment time?
- What workspace/tenant/resource scope bounds it?

### 3.1 Candidate A — Make `ConsentGrant` canonical

Pros:

- Already part of MCP platform lifecycle.
- Natural fit for connector consent and MCP sessions.
- Can tie directly to `ConnectorEnrollment`.

Cons:

- Consent is not general enough for resource grants, LLM accounts, npm accounts, or agent mandates.
- Name and semantics skew toward OAuth/MCP consent instead of all authorization.
- Risk of overloading a specific lifecycle record with general authz.

### 3.2 Candidate B — Make `resource_grants` canonical

Pros:

- Already intended as γ primitive in Personal Hub memory.
- General enough for resources, connectors, accounts and workspace atoms.
- Can project down to MCP `ConsentGrant`, Resource-Plane `discover/read/invoke`, LLM `AuthorizationGrant`, and h2a `ActClaim` checks.

Cons:

- Not yet specified or implemented.
- Requires ARCH-11 clarity to avoid wrong tenant/workspace keys.
- Requires careful migration path for existing MCP/LLM records.

### 3.3 Candidate C — New `AccessGrant` canonical model, with `resource_grants` as table name

Pros:

- Lets us name the conceptual primitive cleanly (`AccessGrant`) while keeping the table/product vocabulary (`resource_grants`) if desired.
- Can explicitly support connector/account/resource/agent subjects.
- Can carry mode, scope, capabilities, conditions, provenance and h2a engagement references.

Cons:

- Another named type could confuse existing docs unless reconciled carefully.
- Requires owner decision on naming and package/API placement.

### 3.4 Owner decision and revised study recommendation

Owner decision (2026-07-06): **Candidate C, but as a policy/index layer that references existing lifecycle records — not as a replacement for them.**

This is an important narrowing from the first draft. `AccessGrant` must not absorb all lifecycle semantics:

- MCP `ConsentGrant` remains the consent/session lifecycle artifact.
- LLM/account `AuthorizationGrant` remains the account-use/accountability artifact where provider ToS and kill-switch rules live.
- Resource Plane `ResourceRef` + `discover/read/invoke` remains the projection/enforcement vocabulary.
- h2a engagements remain opaque h2a-native signed artifacts; Sentropic may require/persist a reference, not interpret mandate semantics.

`AccessGrant` is therefore the **broker policy/index record** that answers “who may do what to which target under which conditions?” and points at the relevant lifecycle/proof records. This avoids the over-abstraction risk identified by adversarial review: consent freshness, provider-account responsibility, resource projection, revocation, and h2a mandate validity have different lifecycles and must not be collapsed.

Recommended conceptual mapping:

- Concept: `AccessGrant`.
- Storage/projection: `resource_grants` (or successor table name ratified in ARCH-11/Personal Hub).
- MCP `ConsentGrant`: referenced as `consentRef` / proof-of-consent, not replaced.
- LLM `AuthorizationGrant`: referenced or embedded as a target-kind-specific sub-policy, using package mode names `direct | explicit-validation | assisted`.
- Resource Plane: `AccessGrant` projects to `discover/read/invoke` deny-as-missing decisions over `ResourceRef` scopes.
- h2a: `h2aEngagementRef` / `act.h2a_eng` stays opaque; Sentropic can check presence, actor binding and signature reference, never semantic mandate validity.

Indicative shape (not final API):

```ts
interface AccessGrant {
  id: string;
  subject: GrantSubject;          // user | agent | service | group | external-principal
  ownerPrincipalSub: string;      // who controls the underlying enrollment/account
  scope: ScopeMap;                // tenant/workspace/resource scope
  target: GrantTarget;            // connectorInstance | account | resourceRef | capability
  capabilities: Array<'manage' | 'discover' | 'read' | 'invoke' | 'write' | 'share'>;
  mode: 'direct' | 'explicit-validation' | 'assisted';
  conditions?: {
    expiresAt?: string;
    requireHumanChallenge?: boolean;
    h2aEngagementRef?: string;
    allowedMcpClients?: string[];
    allowedSurfaces?: string[];
    allowedAgents?: string[];
  };
  provenance: {
    origin: 'sentropic-ui' | 'h2a-local' | 'sync' | 'admin' | 'import';
    enrollmentRef?: string;
    consentRef?: string;
    h2aSignatureRef?: string;
  };
  status: 'active' | 'revoked' | 'expired' | 'suspended';
}
```

## 4. Local h2a ↔ Sentropic sync

This is net-new. The sync protocol must be designed explicitly rather than assumed.

### 4.1 Objects to sync

- Connector definitions available locally.
- Connector enrollments and their non-secret metadata.
- Account enrollments and non-secret descriptors.
- Grant declarations and revocations.
- Secret custody status, not raw secrets.
- Elicitation/2FA pending states.
- Audit summaries / invocation traces, subject to privacy policy.

### 4.2 Objects not synced by default

- Raw OAuth refresh tokens.
- Session cookies.
- 2FA codes.
- Security-key private material.
- Local filesystem paths unless explicitly declared as resources.

### 4.3 Custody modes

The broker needs at least three custody modes:

1. **Local-only** — secret remains in h2a/local vault; Sentropic sees descriptor + status only.
2. **Sentropic-managed** — secret stored in Sentropic KMS/secret store; h2a sees descriptor + revocation/sync state.
3. **Dual-custody handles** — both sides may satisfy calls only through short-lived, sender-bound handles or explicit one-shot migration flows. **Raw secret mirroring is banned by default** for refresh tokens, cookies, npm tokens, LLM account material and security-key state. Any exception requires explicit owner/principal gate, KMS-to-KMS envelope, audit trail and revocation SLA.

### 4.4 Sync direction

Candidate sync mechanisms:

- **Push from h2a to Sentropic**: local enrollment emits signed sync events.
- **Pull by Sentropic**: remote UI asks local h2a agent to expose state when online.
- **Bidirectional event log**: both sides append signed enrollment/grant events and reconcile by content hash/version.

Study recommendation: bidirectional signed event log, but P0 can start with h2a-push for local-to-remote enrollment because it is simpler and preserves local agency.

### 4.5 Conflict policy

- Revocation wins over grant.
- New secret handle never overwrites an active handle without explicit principal confirmation.
- More restrictive scope wins when reconciling ambiguous grants.
- If tenant/workspace binding cannot be resolved, status becomes `needs-attention`, not active.

### 4.6 Threat controls added by adversarial review

The sync protocol must also specify:

- causal versioning and replay protection for signed events;
- revocation tombstones that survive offline periods;
- key rotation and offboarding behavior for h2a identities;
- per-object authority (“which side may authoritatively mutate this enrollment/grant?”);
- privacy filters for local metadata, because h2a descriptors can leak hostnames, local paths, repo names, workspace labels and account inventory;
- split-brain behavior when both local and remote sides can satisfy a call;
- forced `needs-attention` status when authority or custody is ambiguous.

## 5. 2FA and human escalation

The owner explicitly requires npm accounts and 2FA to be managed via Sentropic/h2a like Focus escalations.

Principles:

- Agents and CLIs never see 2FA codes or security-key responses.
- A challenge creates an elicitation record with a narrow purpose, expiry, anti-phishing subject binding and target account/connector.
- Human completes challenge on a trusted Sentropic UI or local h2a surface.
- The broker resumes enrollment/invocation after validation.
- NHI/agent identities never auto-satisfy human challenges.
- Audit records challenge request, surface, outcome and resumed operation, but not secret values.
- Challenges must be **transaction-bound**: provider domain, account, scopes, operation digest, expiry and trusted surface are displayed to the human.
- UX must surface human action at a reliable attention boundary. For CLI-driven work, default to end-of-turn / end-of-conversation notification rather than a hidden mid-flow prompt.
- NHI/agent “delegation resolver” logic may route a challenge to a human, but must never count as human approval by itself.

Examples:

- npm trusted publisher / security key confirmation.
- Google/Microsoft OAuth consent and reauth.
- Slack/HubSpot/Salesforce admin approval.
- AWS/Azure/GCloud account login, role assumption or device-code flow.
- WhatsApp/LinkedIn flows where ToS and anti-automation constraints require explicit human validation.

This should reuse MCP elicitation §5 rather than create a parallel 2FA system.

## 6. Registry residence and package boundaries

P5 is parked in existing specs. The broker intensifies the decision.

### 6.1 Constraints

- The registry has local and remote aspects.
- Published packages should be extracted only when there are real consumers.
- `@sentropic/mcp-platform` now has at least two real consumers: Sentropic MCP provider work and Wave.
- `mcp-registry` itself still may not deserve a public package until the broker creates a second runtime consumer.

### 6.2 Recommended posture

- Publish/activate `@sentropic/mcp-platform` as the public connector adapter contract, but only after converting the current private/mock state into a real publishable package. P1 is a real activation chantier, not a package.json flip.
- Freeze narrowly: manifest, capability classification and scope vocabulary. Do **not** freeze registry storage, grants, custody or sync schemas into the public API until `AccessGrant`/ARCH-11/h2a-runtime consumption are proven.
- Keep registry implementation in the control plane initially.
- Define a registry **event/schema contract** that h2a can emit/consume, but do not necessarily publish `@sentropic/mcp-registry` yet.
- Revisit package extraction when both Sentropic control plane and h2a local runtime consume the same non-trivial registry core.

## 7. UI model: workspace-atom management

The Sentropic UI should eventually expose:

- Connector/account inventory per principal.
- Enrollment status: local-only, Sentropic-managed, synced, needs-attention, revoked.
- Workspace attachment: which workspaces can see or use the connector.
- Capability grants: discover/read/invoke/manage/share.
- Subject grants: me, my agents, selected users, selected groups, external agents, all users in workspace.
- Challenge state: pending 2FA/admin approval/reconsent.
- Audit: recent invocations, touched `ResourceRef`s, agent actor chain.

Foundation-first means v0 UI may show mono-principal inventory and enrollment state before cross-agent/cross-user sharing is enabled.

## 8. Catalog strategy

### 8.1 Catalog classes

1. **Document/storage**: Google Drive, SharePoint, Notion, GitHub, HuggingFace, local files.
2. **Communications**: Gmail, Slack, WhatsApp, LinkedIn.
3. **Business systems**: HubSpot, Salesforce, SAP, ENOVIA, Apriso, Odoo/OpenERP, ClickUp.
4. **Cloud/FinOps**: AWS CLI, GCloud, Azure, Scaleway CLI, NewRelic.
5. **LLM/dev accounts**: Claude Code, Codex, npm, package registries, model providers.
6. **Domain connectors**: Wave and future vertical connectors.

### 8.2 Onboarding order — owner decision

Owner decision (2026-07-06): **Wave(read-only) → npm → GitHub/Google → cloud/FinOps**, then long-tail SaaS.

Rationale and constraints:

- Wave first because it is an active real consumer of `@sentropic/mcp-platform`, but first broker proof should be **read-only**. Wave financial mutations have high blast radius and must wait for stronger grant/audit controls.
- npm account next because it directly unblocks Sentropic package bootstrap and validates human 2FA/security-key escalation. Prefer trusted-publisher/OIDC and sandbox package scope; avoid storing npm tokens.
- GitHub/Google/Microsoft family next because they validate OAuth consent, provider-origin challenges, resource scoping and common SaaS custody patterns.
- Cloud/FinOps connectors next because they validate least-privilege and cost observability, but custody risk is higher, so they should follow the simpler proofs.
- Long-tail SaaS after the adapter/enrollment/grant/sync pattern is proven.

### 8.3 Claude.ai MCP catalog reuse

If a connector is already available as MCP in Claude.ai ecosystem, prefer wrapping/importing its MCP surface through the broker rather than reimplementing from scratch, subject to:

- license and ToS review;
- stable connector IDs;
- capability classification;
- secret custody compatibility;
- audit/trace compatibility;
- deny-as-missing projection.

## 9. Phased plan proposal

### Phase 0 — Foundations/specs (no broad product promise)

- Write ARCH-11 tenant reconciliation EVOL.
- Write broker EVOL defining canonical `AccessGrant` / `resource_grants` relation.
- Ratify `@sentropic/mcp-platform` public API surface with broker-aware freeze.
- Define h2a sync event envelope and threat model.
- Define 2FA/elicitation reuse contract.

### Phase 1 — Mono-principal broker + safe local-agent subset

- Sentropic UI inventory for principal-owned connectors/accounts.
- h2a local enrollment descriptor export.
- One-way sync prototype for local descriptor → Sentropic.
- npm account enrollment/trusted-publisher workflow with human 2FA escalation.
- Wave connector on `@sentropic/mcp-platform`, read-only first.
- Read-only connector catalog entries for first wave.
- Early cross-agent subset allowed by owner: **same-human, same-local-h2a, descriptor-only / human-mediated** use. No raw secret sharing, no Sentropic-managed invocation, no cross-user grant, and no durable workspace grant keyed to unstable tenant aliases.

### Phase 2 — Workspace-scoped grants

- Implement canonical grant storage and deny-as-missing projection.
- Attach connectors/accounts to workspaces with `discover/read/invoke` capabilities.
- Audit via `ToolInteractionTrace`.
- Support Sentropic-managed and local-only custody modes.

### Phase 3 — Cross-agent/cross-user

- Require 39h/agent identity foundation.
- h2a engagements referenced in `AccessGrant` conditions.
- External agents and other users can be granted scoped capabilities.
- Human validation modes (`explicit-validation`, `assisted-mode`) become active.

### Phase 4 — Catalog scale-out

- Expand SaaS/cloud/business connectors using the proven adapter + grant + sync pattern.
- Add FinOps dashboards for cloud spend and NewRelic observability.
- Consider package extraction for registry core if h2a and Sentropic share implementation.

## 10. Owner decisions and remaining open decisions

Owner decisions incorporated on 2026-07-06:

1. `AccessGrant` direction: **yes**, as policy/index record that references existing lifecycle records, not a fusion object.
2. Secret custody: **handle-first**, raw secret mirroring banned by default; only explicit migration or short sender-bound handles may be considered.
3. Early value: **allow same-human h2a-local descriptor/human-mediated subset** before full ARCH-11/39h cross-agent rollout.
4. Catalog wave: **Wave(read-only) → npm → GitHub/Google → cloud/FinOps**.

Remaining decisions for the EVOL/spec gate:

1. Exact `AccessGrant` schema, target-kind sub-schemas, storage name and migration relation to `ConsentGrant`/LLM `AuthorizationGrant`.
2. Registry residence posture: control-plane first, event contract shared, package later — still needs final ratification with BR-70/resource-plane owner.
3. UI first slice: inventory/enrollment before sharing controls, or include read-only grant visualization immediately.
4. Whether broker EVOL and ARCH-11 EVOL are separate specs or a coupled program with one acceptance gate.
5. Opus peer review re-run and reconciliation before irreversible public API freeze.

## 10.5 Factual corrections from adversarial review

The first draft intentionally leaned on prior grounding; Codex review corrected several stale claims that future EVOL text must preserve:

- MCP auth is further along than the draft implied: `auth-hono` has RFC 8707 resource/audience work and `mcp-auth` has PRM/challenge semantics; DCR and full registry/authz remain deferred.
- `@sentropic/mcp-platform` is not currently a public active package on `origin/main`; it is private/mock/not root-locked. P1 publication requires real activation and public API freeze.
- LLM gateway has real v0 personal-passthrough/account enforcement code even if local gateway server paths still contain placeholders; cross-user authz remains gated.
- LLM authz mode names are `direct | explicit-validation | assisted`.
- h2a registry is predominantly empty-capability/local-files today, but not literally every historical record has `capabilities: []`; do not rely on that as an invariant.

## 11. Risks

- Freezing `@sentropic/mcp-platform` too narrowly for Wave would force a breaking bump when the broker arrives.
- Building workspace grants before ARCH-11 may encode the wrong tenant key.
- Treating 2FA as just another agent task could leak secrets; it must remain human escalation.
- Syncing raw secrets across local/remote boundaries may create unacceptable custody risk.
- Reusing third-party MCP connectors without capability classification may violate deny-as-missing and audit guarantees.
- Cross-agent grants without 39h identity/DPoP may be unverifiable.

## 12. Current recommendation

Adopt a Foundation-first program with two parallel lanes:

- **Foundation lane**: ARCH-11 + canonical grant primitive + h2a sync protocol + 2FA escalation contract.
- **Value lane**: broker-aware `@sentropic/mcp-platform` activation, Wave migration, npm/trusted-publisher account proof, mono-principal catalog UI.

Do not ship cross-user/cross-agent/workspace-atom sharing until the foundation lane has produced stable tenant and grant semantics.

