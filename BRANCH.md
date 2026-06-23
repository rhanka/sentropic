# Feature: BR-39r L4 — OIDC Evolution 2 (login_hint + single-use invite → device enrollment)

## Objective
Additive OIDC Evolution 2 on the standalone IdP: honor `login_hint` and a namespaced single-use `sentropic_invite_token` (invitation → direct device enrollment), wire host register presets, and resume the OAuth continuation on register success. `@sentropic/auth-hono` 0.9.0 → 0.10.0. Zero discovery change.

## Scope / Guardrails
- Scope limited to auth-hono package, api auth routes/services/schema, host register pages, and AuthLogin (login_hint preset only).
- One migration max in `api/drizzle/*.sql` (the new `auth_invite_tokens` table).
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/br39r-l4`.
- Automated tests on dedicated env `test-idprpl4` (API_PORT=9302, UI_PORT=5302, MAILDEV_UI_PORT=1132), never root `dev`.
- In every `make` command, `ENV=<env>` is passed last.
- All new text in English.
- STACKED on `feat/idp-oidc-rp-l3`; PR base = main AFTER L3 merges.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/tests/**`
  - `api/src/routes/auth/**`
  - `api/src/services/**`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql` (max 1 file)
  - `api/tests/api/auth/**`, `api/tests/unit/auth/**`
  - `apps/auth-idp/web/src/routes/auth/register/**`
  - `ui/src/routes/auth/register/**`
  - `packages/auth-ui/src/components/AuthLogin.svelte`, `packages/auth-ui/package.json` (login_hint only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `package-lock.json` (root) — only via `make lock-root` after an auth-ui bump (EX pattern from L3)
- **Exception process**:
  - Declare `BR39rL4-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BR39rL4-EX1` (`acknowledge`): touch root `package-lock.json` via `make lock-root`. Reason: bumping `@sentropic/auth-hono` to 0.10.0 broke the workspace `npm ci` (auth-ui peer capped at ^0.9.0); widened auth-ui's auth-hono peer to include ^0.10.0 and relocked. Impact: lockfile self-versions sync to auth-hono 0.10.0 / auth-ui 0.6.0 (same EX pattern used by L3-EX1). Rollback: revert the two package.json edits + `make lock-root`.

## AI Flaky tests
- Not applicable (no AI tests in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single additive capability, one PR, no independent CI needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only (conductor-driven after L3 lands). Deep-link → enrollment → RP-return round-trip deferred to e2e/UAT (see `## Deferred`).

## Deferred
- **Invite issuance** (creating `auth_invite_tokens` rows + sending the invite email) is OUT of scope. L4 only CONSUMES invites at registration. Issuance belongs to the inviting surface (membership/admin flow) — owner-side follow-up.
- **e2e round-trip** (deep-link → enrollment → RP return) deferred to UAT/e2e once L3+L4 land (AI-e2e gate stability); unit/api tests cover the security paths.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/testing/data rules + L4 design + L3 design + study 358 + BRANCH_TEMPLATE.
  - [x] Confirm worktree `tmp/br39r-l4` on `feat/idp-oidc-rp-l4`.
  - [x] Capture Makefile targets: `typecheck-api`, `lint-api`, `test-auth-hono`, `test-api-endpoints`/`test-api-unit` (SCOPE), `lock-root`.
  - [x] Env mapping: `test-idprpl4` API 9302 / UI 5302 / Maildev 1132 (verified free via `make ps-all`).
  - [x] Confirm scope boundaries.

- [x] **Lot 1 — Single-use invite-token store (auth-hono port + table + migration)**
  - [x] Add `AuthHonoInvitesPort` (`findValid`, atomic `consume`) to `packages/auth-hono/src/ports.ts` as optional `invites?`.
  - [x] Add `auth_invite_tokens` table to `api/src/db/schema.ts` (id, token_hash UNIQUE, email, client_id nullable, expires_at, consumed_at nullable, consumed_by_user_id nullable, created_at).
  - [x] One migration `api/drizzle/0036_auth_invite_tokens.sql` + journal entry (hand-written: project keeps drizzle snapshots drifted; migrator applies via `_journal.json`).
  - [x] Add api adapter `api/src/services/auth/invite-store-adapter.ts` (hash-at-rest SHA-256; atomic UPDATE ... WHERE consumed_at IS NULL AND expires_at>now RETURNING email).
  - [x] Bump `packages/auth-hono/package.json` 0.9.0 → 0.10.0; widen auth-ui peer + bump auth-ui 0.6.0 + `make lock-root` (EX1).
  - [ ] Lot gate: `make typecheck-api ENV=test-idprpl4` (run with later lots).

- [x] **Lot 2 — authorize honors login_hint + sentropic_invite_token (routing only, C3 no-enum)**
  - [x] Add `registerUrl` option to `OAuthAuthorizeHandlerOptions`.
  - [x] In the L3 `!session || forceReauth` block: route invite (presence only) → registerUrl; login_hint alone → loginUrl w/ email hint; live same-user → continue; live session w/ email≠login_hint → force switch (reuse L3 forceReauth).
  - [x] Carry login_hint + sentropic_invite_token as PLAIN register-URL params.
  - [x] Wire `registerUrl` in `api/src/routes/auth/oauth.ts` (`createSentropicOAuthOptions`).
  - [ ] Lot gate: `make typecheck-api ENV=test-idprpl4` (run with later lots).

- [ ] **Lot 3 — registration validates + consumes invite atomically pre-persist + generic fallback**
  - [ ] Add a pre-persist hook (`beforePersist`) threaded verify→consume→persist (no orphan credential if consume loses the race).
  - [ ] Wire invite consume into `api/src/routes/auth/register.ts`: recognize `sit_` token, consume atomically after WebAuthn verify, before credential insert; bind token↔email; skip email-verification when valid invite.
  - [ ] C3: collapse invalid/expired/consumed/email-mismatch/unknown into the generic "verify email" fallback (no `invalid_invite` error).
  - [ ] Lot gate: `make typecheck-api ENV=test-idprpl4`.

- [ ] **Lot 4 — host register pages: wire presets + RESUME OAuth continuation (both hosts)**
  - [ ] `apps/auth-idp/web/src/routes/auth/register/+page.svelte`: read login_hint→presetEmail, sentropic_invite_token→presetVerificationToken, skipEmailVerification when invite present; on success RESUME `continue` (mirror login page) else fallback goto.
  - [ ] `ui/src/routes/auth/register/+page.svelte`: same wiring + continuation resume.

- [ ] **Lot 5 — (if needed) AuthLogin presetEmail for login_hint**
  - [ ] Add `presetEmail` prop to `AuthLogin.svelte` → pass to `createPasskeyAuthenticationOptions({ email })`.
  - [ ] Wire login_hint→presetEmail in both login pages.
  - [ ] Bump `packages/auth-ui/package.json` (minor) + widen auth-hono peer to include ^0.10.0 + `make lock-root` (BR39rL4-EX1).

- [ ] **Lot 6 — Tests**
  - [ ] `packages/auth-hono/tests/oauth-authorize-login-hint-invite.test.ts`: invite present → registerUrl; login_hint alone → loginUrl w/ hint; same-user session → continue; session email≠login_hint → force switch.
  - [ ] `packages/auth-hono/tests/webauthn-registration-before-persist.test.ts`: beforePersist runs after verify, before persist; throw → no credential created (no orphan).
  - [ ] `api/tests/unit/auth/invite-store-adapter.test.ts`: valid/unknown/expired/consumed/email-mismatch states; single-use concurrency (two parallel consume → exactly one winner).
  - [ ] `api/tests/api/auth/registration.test.ts`: invite states → identical public behavior (generic fallback); valid invite skips email-verification.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api ENV=test-idprpl4`, `make lint-api ENV=test-idprpl4`.
  - [ ] `make test-auth-hono ENV=test-idprpl4`.
  - [ ] `make test-api-endpoints SCOPE=tests/api/auth/registration.test.ts ENV=test-idprpl4` + `make test-api-unit SCOPE=tests/unit/auth/invite-store-adapter.test.ts ENV=test-idprpl4`.
  - [ ] Verify ZERO discovery golden diff.
  - [ ] Bumped affected `packages/<pkg>/package.json` versions.
  - [ ] `make down ENV=test-idprpl4`.
  - [ ] PR base=main AFTER L3 merges (conductor handles push/PR/merge).
</content>
</invoke>
