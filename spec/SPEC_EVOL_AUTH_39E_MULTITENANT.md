# SPEC_EVOL — BR-39e : Multi-tenant identity (tenant registry + membership + tenant-scoped acceptance + tenant claim)

> Status: SCOPED (decided). Consolidates `/tmp/39e-scope-draft.md` v2 after double-review (Codex 5.5-high + Opus 4.8-max) and the owner decisions of 2026-06-07. Federation-first was rejected by both reviewers; v1 spine = identity-scoped tenancy. Owner widened scope from "immo-first" to **broad** ("plus large d'emblée"). To be deleted after consolidation into BRANCH.md lots + tests.

## 1. Objective
Add a real **tenancy spine** to the standalone IdP (`auth.sent-tech.ca`): model *which organization a human belongs to* (not just *which client they logged into*), with per-(user,tenant) membership, tenant-scoped acceptance, and an immutable tenant claim in tokens — designed from the start for **multiple consumers** (immo, diag, design-system, and an openerp brokered lane), on the shared IdP DB.

## 2. Schema reality (verified, pre-39e)
- `tenant_id` exists ONLY on client/token tables (`oauth_clients`, `authorization_codes`, `oauth_tokens`, `service_clients`) — server-side `TokenMeta` only, **never a JWT claim**.
- Identity tables (`users`, `webauthn_credentials`, `user_sessions`, `magic_links`, `email_verification_codes`) carry **ZERO tenancy**. `users.email` is **globally `unique()`**.
- `accountStatus = pending_admin_approval` is a single **global** column; `admin_org` is a **global** role.
- Already present: `organizations` / `workspaces` / `workspace_memberships` (roles viewer/commenter/editor/admin), SHARED `users` (IdP on shared DB).
- ⇒ Today "tenancy" = the client you logged into, NOT the org the human belongs to. That gap is exactly immo's (and openerp's) unmet need.

## 3. Decisions (DECIDED — do not reopen)
- **D0 — identity model = (A) one user, many memberships.** Membership table; `tenant_id` is NOT added to `users`; global-unique `email` is KEPT. Mirrors existing `workspace_memberships`; lets one human span immo+diag; avoids email-uniqueness breakage. *(Owner-confirmed.)*
- **D1 — v1 spine = tenant registry + per-(user,tenant) membership + tenant-scoped acceptance.** OIDC Federation is OUT of v1.
- **D2 — openerp = trusted external issuer + RFC8693 token-exchange (brokered), in a separate lane** — NOT OIDC Federation 1.0 (wrong-sized: openerp is first-party, same org, already issues RFC8693). Confirmed by openerp consumer (AX2 = federated org, they keep their own identity/tenancy and own org membership).
- **D3 — scope = BROAD** *(owner override of the immo-first reco)*: build the full spine (registry + membership + acceptance + tenant claim + RP onboarding) for all consumers from the start; immo remains the first concrete validation, not the scope ceiling.
- **D4 — acceptance ownership = minimal `auth-admin` role NOW** (auth owns the approval verdict + stores the membership row + tenant partition). The verdict migrates to h2a/app governance (a CONFIANCE/mandate act) in a later lot. *(Owner-confirmed; genuine fork resolved toward auth-admin v1.)*
- **D5 — migration on SHARED DB**: backfill a default `sentropic` tenant + an `approved` membership for every existing user. Blast radius = the LIVE main-app `users` table → the ALTER-DEFAULT incident lesson applies (migrations must set live defaults, not only update rows).
- **Cut:** nested `parent_tenant_id` in the platform IdP (no consumer).
- **design-system = the public/default tenant** (persona/test surface, NOT an isolation tenant). Ties into the b.2 public clients already registered.

## 4. Consumer inputs (from h2a, folded in)
- **openerp** (claude:openerp): runs BOTH standalone AND embedded; embedded = OIDC RP consuming our discovery + Ed25519 JWKS, maps `(iss,sub) → local UserIdentity → org memberships`; standalone = its own IdP. Sub-tenants **dynamic + unbounded** (`organizations` + `organization_members`, forced RLS). No user-sharing exclusivity required. Tenant/org claim **NOT required**, but an **optional `org` HINT claim** improves default-org selection on first embedded SSO landing (treated as a hint, never as authorization). Foundations already shipped: public `GET /openapi.json`, `POST /auth/exchange-agent-token` (RFC8693, scope-intersected, ttl-capped), verified-JWT tenant resolver.
- **design-system** (claude:sent-tech-design-system): public/PKCE RP, no roles authority (personas non-authoritative). Acts as the default/public tenant.

## 5. Three seams (authority boundaries)
1. **Identity / credential / scope = IdP.** (sub, email, auth, requested scopes.)
2. **Membership ≠ trust ≠ authorization.** Membership = a (user,tenant) row with a status; trust/mandate = h2a/governance; authorization = the consuming app (e.g. openerp owns org-level authz + RLS).
3. **Tenant claim is derived from VALIDATED membership**, never from a request param.

## 6. v1 schema (target)
- `tenants` : `id` (immutable slug/`tid`), `name`, `status` (active/suspended/offboarded), `created_at`, `updated_at`. Seed row `sentropic` (default/public). NO `parent_tenant_id`.
- `tenant_memberships` : `(user_id, tenant_id)` unique; `status` ∈ {invited, requested, approved, rejected, suspended}; `role` (tenant-scoped, e.g. member/admin); `approved_by` (auth-admin user id, nullable); `requested_at`/`decided_at`; mirrors `workspace_memberships` shape.
- `oauth_clients.tenant_id` : associate each client to a tenant (RP onboarding); design-system clients → `sentropic` tenant.
- NO change to `users` (no `tenant_id`, email stays global-unique). NO change to `webauthn_credentials`/sessions.

## 7. Token / flow invariants (hardened — into tests)
- Every token bound to `client_id + tenant + membership status + iss + aud + session`.
- Tenant claim = immutable `tid`/`org_id`, derived from a VALIDATED `approved` membership; **never** a request param.
- **Tenant selection at `authorize`** when a user has several approved memberships (account-chooser-style); single membership → implicit.
- `(iss,sub)` composite reserved for EXTERNAL issuers (openerp lane). Within-IdP single issuer ⇒ `sub` alone.
- Per-tenant acceptance: per-membership status, **tenant-scoped approver**, pending cap + rate-limit + anti-enumeration.
- Tenant lifecycle gates (active/suspended/offboarded) enforced on every flow (authorize, token, userinfo, introspect).
- Every tenant-scoped query is tenant-filtered; **negative tests A→B** (a member of tenant A must never read/act in tenant B).
- Optional `org` HINT claim (openerp embedded) is advisory only — apps must treat it as non-authoritative.

## 8. Lots (broad scope; sequence)
- **Lot 1 — Tenancy core (schema + migration).** `tenants` + `tenant_memberships`; D5 migration backfilling default `sentropic` tenant + `approved` membership for all existing users (live-default-safe). Negative-test harness scaffold.
- **Lot 2 — Tenant-scoped acceptance.** Membership status machine; minimal `auth-admin` role (D4); request→approve/reject flow; pending cap + rate-limit + anti-enumeration; tenant-scoped approver authority.
- **Lot 3 — Tenant claim + selection.** Immutable `tid` claim from validated membership; tenant selection at authorize for multi-membership users; bind tokens to tenant+membership+session; lifecycle gates.
- **Lot 4 — RP onboarding / tenant↔client.** `oauth_clients.tenant_id` association; tenant-scoped client governance (redirect/CORS governance per tenant); design-system = default tenant wired to the b.2 clients.
- **Lot 5 — openerp brokered lane (spike, separate).** Trusted external issuer + RFC8693 token-exchange; `(iss,sub)` composite; optional `org` hint claim. NOT OIDC Federation. May land after Lots 1-4.

## 9. Out of scope (v1)
- OIDC Federation 1.0 / dynamic federation.
- Nested tenants (`parent_tenant_id`).
- Migrating the acceptance verdict to h2a-governance (later lot, after D4 auth-admin v1).
- Per-tenant email (kept global-unique under D0/A).

## 10. Risks
- **Shared-DB migration (D5)** touches the LIVE main `users` population — careful, reversible, live-default-safe migration; backfill must be idempotent.
- **Email global-unique under D0/A** — a human is one `users` row across tenants; ensure no flow assumes user↔tenant 1:1.
- **Acceptance enumeration** — anti-enumeration + rate-limit are invariants, not nice-to-haves.
- **Token claim correctness** — tenant claim must never be attacker-influencable (derived from membership only).
