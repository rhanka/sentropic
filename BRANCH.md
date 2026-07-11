# Feature: BR-39e Lot 0 — identities table + federation port + server-side flow-state

## Objective
Foundation substrate for social/enterprise federation (BR-39e): the `identities` link table, the
optional auth-hono `federation?` port, the SAFE resolve-or-create algorithm (D6/D7), and the
one-time server-side federation flow-state store (D5). No external-provider code (Lot 1).

## Scope / Guardrails
- Scope limited to `packages/auth-hono/src/**`, `api/src/**` (schema + adapter + port wiring, no provider routes), one `api/drizzle/*.sql`, `packages/auth-hono/package.json`, tests.
- One migration max in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); work happens in `tmp/br39e-lot0`.
- Test campaigns on `ENV=test`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/tests/**`
  - `api/src/**`
  - `api/tests/**`
  - `api/drizzle/*.sql` (max 1 new file) + `api/drizzle/meta/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `apps/**`, `packages/auth-ui/**`, `packages/design-system*/**`, other packages
- **Conditional Paths**:
  - `api/drizzle/*.sql` (max 1 file)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BR39E-EX1` (scope exception — `packages/auth-ui/package.json`):
  - Reason: the mandated `@sentropic/auth-hono` minor bump 0.11.1 → 0.12.0 makes `auth-ui`'s
    peerDependency range (`... || ^0.11.0`) reject the workspace-linked 0.12.0, breaking `npm ci`
    for the whole workspace (and thus typecheck/lint/test/CI).
  - Change: append `|| ^0.12.0` to the `@sentropic/auth-hono` peer range (one token; additive).
  - Impact: backward-compatible range widening only; no auth-ui code/behavior change.
  - Rollback: remove the ` || ^0.12.0` token if the auth-hono bump is reverted.

## AI Flaky tests
- (none expected — no AI paths in this lot)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal substrate lot, no independent sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — federation substrate**
  - [x] `identities` + `federation_flow_states` tables in `api/src/db/schema.ts` (one migration)
  - [x] `federation?` optional port + types in `packages/auth-hono/src/ports.ts`
  - [x] SAFE `resolveOrCreateFederatedUser` (D6/D7) in `packages/auth-hono/src/federation/resolve-user.ts`
  - [x] Drizzle `createFederationAdapter` in `api/src/services/auth/federation-adapter.ts`
  - [x] Wire `federation` into the host ports bag (`api/src/routes/auth/oauth.ts`)
  - [x] Bump `@sentropic/auth-hono` 0.11.1 → 0.12.0
  - [x] Tests: resolver (K-SUBJECT/K-AUTOLINK-SHELL/K-NOMERGE-CRED/K-NOMERGE-UNVERIFIED/K-UNIQUE) + adapter (K-UNIQUE/K-FLOW/K-STATE)
  - [ ] Lot gate: `make typecheck`, `make lint`, `make db-migrate`, scoped tests
