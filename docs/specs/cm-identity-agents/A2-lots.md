# A2 implementation lots on top of the A2.0 contracts (+ A4 app replacement order)

Source: spec r2 (APPROVED, `f24480ee…cd518`), milestone order M0 → L1/L2/L3 → M1–M5.
A2.0 (this lane, [PR #855](https://github.com/rhanka/sentropic/pull/855)) froze the public
contracts only: `packages/cluster-mesh/src/identity-contracts/` (types, ports,
error codes, versioned descriptors, in-memory doubles) + `tests/identity-*.spec.ts`.
No durable backend, no app change. F11 screens are NOT in A2.0; they land with A4.3.

## Parallelism contract (binding for all three lots)

- Lots implement disjoint store slices behind the FROZEN ports. No lot changes
  `src/identity-contracts/` semantics; a needed contract change stops all lots
  and lands as an A2.0 amendment first (descriptors carry `contract-only` until then).
  The A2.0 contracts already freeze: the §2.7 `inputKind` discriminator with the
  evaluated session authority named in every F15 verdict and refusal (unbound
  kinds refuse `session_authority_unavailable` until their authority store lands);
  the F02 self-service ops (`getSelf`, `disableSelf`, `deleteSelf`); the F04
  device-code issue/poll/approve triplet behind `DeviceCodeStore`; and the F14
  step union complete vs r2 (remote/reader sessions, connector grants, purpose
  grants, catalogue are receipted `not_applicable` until their planes land).
- Every lot runs `tests/identity-*.spec.ts` UNMODIFIED against its PostgreSQL and
  SQLite backends (the in-memory doubles are the reference oracle).
- One logical schema, two profiles (§2.9): hosted PostgreSQL control schema +
  local SQLite schema set, both through the existing `src/storage/` kernel.
  Same fail-closed checks; only backend and tenant cardinality differ (Q-H default:
  single tenant locally, no code special-case).
- No dual writer at any boundary; no legacy fallback (COMMON-RULES).
- `ENV=test-*`/`e2e-*` last, Docker under the packet flock, `make down` after.

## Lot A2.1 — Accounts, proofs, invitations, login sessions (F02–F05, F10-accounts)

- Files: `src/storage/` identity tables + PG/SQLite port implementations for
  `UserAccountStore`, `IdentityProofStore`, `InvitationStore`, `DeviceCodeStore`,
  `LoginSessionStore`; wire `createUserAccounts`, `createIdentityProofs`,
  `createInvitations`, `createDeviceEnrolment`, `createLoginSessions` (incl.
  self-action refusals, admin-user protection, delete-requires-disabled,
  `listUsers`, and the F02 self-service ops).
- Tests: contract suite unmodified on both profiles + storage round-trip specs
  (concurrency: single-use invitation consumed exactly once; revoke-all effective).
- Acceptance: registration → pending → approval → login from the same stores on
  both profiles; invitation consumed exactly once under concurrency; revoke-all
  effective on the next call; no identity write path outside the ports.

## Lot A2.2 — Tenants, memberships, workspaces, resolution, tid (F01, F06–F08, F12–F13)

- Files: stores for `TenantRegistryStore`, `TenantMembershipStore`,
  `WorkspaceDirectoryStore`, `WorkspaceMembershipStore`, `OAuthTenantStore`;
  wire `createTenantRegistry` (slug conflict, offboard guard), `createTenantMemberships`
  (full cycle incl. `inviteMember`, transition table, anti-enumeration shape),
  `createWorkspaceDirectory` (one workspace per repo: `workspace_already_enrolled`
  with the existing id; repo-less recording per Q-A; alias approval; last-admin guard),
  `createTenantResolver` (authoritative + alias/shadow transition tooling + divergence
  metrics), `createTidIssuer`, `createTenantOAuth`.
- Tests: contract suite unmodified on both profiles + uniqueness/alias/transition
  specs + shadow-vs-strict replay specs.
- Acceptance: gap-§1 scenario end-to-end (account approved ≠ membership approved);
  second enrolment of the same repo returns the existing id; clones join only via
  approved alias; distinct repos stay distinct; no duplicate workspace remains;
  forged workspace/tenant ids never yield a tid; shadow measures without changing.

## Lot A2.3 — RBAC inputs, admin surface, cascade, fresh decision (F09–F10, F14–F15)

- Files: `createFreshDecision` over the A2.1/A2.2 stores — the §2.7
  `inputKind`/session-authority shape is frozen in the A2.0 contracts; bind the
  conversation authority store when it lands (unbound kinds keep refusing
  `session_authority_unavailable`); refusal yields an empty tool set, never
  partial; `createPersonCascade` (audited per-step receipts; partial failure
  queued and visible; the F14 step union is frozen complete vs r2 — bind
  `agent_plane` through `AgentPlaneRevocationPort` (M4) and let later planes
  turn `not_applicable` receipts into `applied`);
  audit/escalation ledger schema for §7 records (collection only until L3).
- Tests: contract suite unmodified on both profiles + decision-matrix specs
  (HTTP expiry vs logout-during-turn vs conversation revocation as separate cases) +
  cascade specs incl. one injected step failure left visible.
- Acceptance: mid-session suspension empties the tool set on the next call;
  cascade receipts enumerate every step; `TENANT_RESOLUTION_MODE`-style permanent
  modes are absent (transition tooling deleted at cutover per F12).

## A4 — App-side replacement order (after the matching A2 lot + hosted milestone)

General cutover rule (r2 §5): one data migration into the cluster-mesh store, one
author switch per namespace under the r13 D11 protocol (rollback checkpoint recorded
BEFORE any legacy identity table is deleted), then deletion of the app table /
service / route in the same lot. The app keeps business data only.

1. **A4.1** (needs A2.1): `/auth` + `/session`. Migrate `users`, proof tables,
   invitations, login sessions; serve the `auth-hono` user port from identity stores;
   delete `api/src/db/schema.ts:147-270`, `registration.ts`, `account.ts`,
   `session-manager.ts` identity paths.
2. **A4.2** (needs A2.2): `/workspaces` (absorbs `/tenants`). Migrate tenants, both
   memberships, workspaces (bind repo identity or record repo-less per Q-A; merge
   duplicates per the §2.3 inventory); delete the app-implemented membership seam
   (`api/src/services/cluster-mesh-adapter.ts:113-122`, `ValidatedMembershipPort`
   leaves the public surface), `tenant-membership.ts`, product tenant/workspace routes.
3. **A4.3** (needs A2.3): resolution + `tid` + admin + F15 + screens. Delete
   `resolve-tenant.ts`, `TENANT_RESOLUTION_MODE`, the OAuth `tid` legs
   (`oauth.ts`, consent/service adapters), the identity parts of
   `admin-product-authority.ts`; replace `request-authority.ts` (W4.a) with F15 —
   GATE: owner Q-G answer recorded at M0 first (§9.3: no implied acceptance);
   land F11 screens (login, registration, admin, membership decision, members).
4. Agent plane (M4: memorial agents, `WorkspaceIdMapping`, H1–H4) and federation
   objects (M5) are NOT A4; they follow on the same contracts.

## Explicitly out of A2/A4

F11 screens (A4.3), agent-plane records and `WorkspaceIdMapping` (M4),
`WorkspaceIdMapping` conflicts queue (owner resolution, never auto-merge),
federation links (M5), producer work (blockers 1/2/4, PW5/Q-F — owned elsewhere),
request ceilings/counters (backend concern, acceptance in A2.2).
