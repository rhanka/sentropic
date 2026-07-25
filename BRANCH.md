# Fix: trusted-proxy client IP + auth rate limiters on the standalone IdP

## Objective
Close two live security defects found while chasing the XFF/trusted-proxy prerequisite named at
`spec/SPEC_EVOL_QUOTA_LEDGER.md:11,42`:
1. All seven auth rate limiters keyed on a RAW `X-Forwarded-For` read while `ui/nginx/default.conf`
   never set that header — so the key was caller-controlled and every limiter was bypassable.
2. The standalone IdP (`auth.sent-tech.ca`, public, live) had NO rate limiting at all, and a comment
   asserted the opposite.
Both were confirmed by two independent adversarial reviews (Opus 4.8 xhigh + Codex 5.6-terra xhigh),
which BOTH returned DO-NOT-SHIP on the first cut of this branch; this is the reworked version.

## Scope / Guardrails
- Security fix only. No schema, no migration, no product feature change.
- Make-only workflow; `ENV=<env>` last. Tests on `ENV=test-xff`, never on root `dev`.
- All new text in English.
- Deploy-side values (hop counts / trusted CIDRs) are NOT guessed here — see `BR-XFF-N1`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/utils/client-ip.ts` (new — trusted-proxy client IP resolver)
  - `api/src/middleware/auth-rate-limiters.ts` (new — limiters shared by both apps)
  - `api/src/app.ts` (consume the shared limiters)
  - `api/src/config/env.ts` (`TRUSTED_PROXY_CIDRS`, `TRUSTED_PROXY_HOPS`)
  - `apps/auth-idp/idp-app.ts` (apply the limiters; correct the false comment)
  - `ui/nginx/default.conf` (set `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto`)
  - `api/tests/unit/client-ip.test.ts` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `api/drizzle/**`, `api/src/db/**`, `ui/src/**`, `packages/**`, `spec/**`, `PLAN.md`
  - `deploy/**` — see `BR-XFF-N1`; the hop/CIDR values are not mine to invent
- **Conditional Paths (allowed only with explicit exception)**: none.
- **Exception process**: declare `BR-XFF-EXn` in `## Feedback Loop` first.

## Feedback Loop
- `BR-XFF-N1` (`blocked`, deploy-side): `TRUSTED_PROXY_HOPS` appears NOWHERE in `deploy/` (verified),
  so production would inherit the code default. The two public paths have DIFFERENT chains —
  `sentropic.sent-tech.ca` = Traefik → ui/nginx → api, `auth.sent-tech.ca` = Traefik → pod — so a single
  implicit default is wrong for one of them. Opus showed that a wrong-low hop count returns the Traefik
  pod IP for EVERY client, collapsing all limiters into one bucket (`authSessionRateLimiter` is 30/min
  and fires on every page load → cluster-wide 429s). **This branch must NOT be deployed until the real
  topology is supplied.** Asked to `claude:poc-k8s` (envelope `msg-xff-topology-20260725-01`): exact
  append behaviour per host, trusted proxy CIDRs, and whether the SCW LoadBalancer preserves client IP.
  Owner routed this to the k8s lane on 2026-07-25.
- `BR-XFF-N2` (`attention`): both reviewers converged that hop-counting ALONE is unsafe — it holds only
  if every counted proxy appends exactly one entry; a non-appending proxy plus an attacker-padded header
  makes an over-high count select forged data. Hence `TRUSTED_PROXY_CIDRS` (peer-trust mode) is the
  PREFERRED path and hop-counting is the documented fallback. Once the k8s lane supplies CIDRs, prefer
  mode 1 and pin the values explicitly per overlay rather than relying on any default.
- `BR-XFF-N3` (`attention`, deferred, NOT fixed here): seven call sites still write a raw
  `X-Forwarded-For` into `user_sessions.ip_address` — `api/src/routes/auth/{login.ts:87, register.ts:366,
  federation.ts:65, magic-link.ts:155, magic-link.ts:203, session.ts:123, device.ts:87}`. After this
  branch the limiter keys on the true IP while the audit row still records a forgeable one, which both
  reviewers flagged. Each is a one-line swap to `resolveClientIp(c)`; deferred to keep this commit's
  blast radius to the security-critical path.
- `BR-XFF-N4` (`attention`, pre-existing, explains the miss): `api/src/app.ts` treats ANY non-empty
  `DISABLE_RATE_LIMIT` as "disabled", while `api/tests/limit/rate-limiting.test.ts` treats `'false'`/`'0'`
  as "enabled". The only end-to-end rate-limit assertions in the repo therefore never execute
  meaningfully — plausibly why this whole defect class went unnoticed. Not fixed here; deserves its own
  branch.
- `BR-XFF-N5` (`attention`, environment, NOT caused by this branch): `make install-internal-packages`
  fails with an npm cache permission error inside the container, which removes `api/node_modules/@types/node`
  and then breaks `build-llm-mesh` with TS2688. Codex hit the SAME TS2688 independently while reviewing.
  Consequence for this branch: the extended vitest suite could not be re-run locally after that damage —
  see `## Checks`.

## AI Flaky tests
- No AI generation surface touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal security fix across two apps that must move together.

## UAT Management (in orchestration context)
- No UI surface. UAT = review of the diff + CI, then a deploy-side verification that a real request
  yields ONE bucket per real client (not one global bucket). The deploy verification cannot happen
  before `BR-XFF-N1` is answered.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Establish the defects**
  - [x] Verify the seven limiters read `X-Forwarded-For` raw (`api/src/app.ts`, pre-fix).
  - [x] Verify `ui/nginx/default.conf` never set it.
  - [x] Verify `rateLimiter` exists ONLY in `api/src/app.ts`, and that `apps/auth-idp/idp-app.ts:69`
        builds its own `new Hono()` and mounts `authRouter` at `:152` — so the IdP had none.
  - [x] Verify `TRUSTED_PROXY_HOPS` is absent from `deploy/`.

- [x] **Lot 1 — Client IP from trusted proxies**
  - [x] `api/src/utils/client-ip.ts`: peer-trust CIDR mode (preferred) + hop-count fallback,
        IPv4-mapped-IPv6 normalization, socket-peer fallback wrapped so it cannot throw.
  - [x] `api/src/config/env.ts`: `TRUSTED_PROXY_CIDRS` + `TRUSTED_PROXY_HOPS`, both documented with
        the failure mode of setting them wrong.
  - [x] `ui/nginx/default.conf`: set `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
  - [x] `api/tests/unit/client-ip.test.ts` (18 cases).

- [x] **Lot 2 — Rate limiters shared with the IdP**
  - [x] `api/src/middleware/auth-rate-limiters.ts`: the seven limiters + `applyAuthRateLimiters`.
  - [x] `api/src/app.ts` consumes the shared module (no behaviour change on the product API).
  - [x] `apps/auth-idp/idp-app.ts` applies them; the false comment is replaced by the real explanation.

- [ ] **Lot 3 — Deploy-side + close**
  - [ ] `BR-XFF-N1` answered by the k8s lane; pin the values explicitly per overlay.
  - [ ] CI green.
  - [ ] Deploy-side verification that a real client maps to its own bucket.

## Checks (results)
- `make test-api SCOPE=tests/unit/client-ip.test.ts ENV=test-xff` — **9/9 PASS** on the Lot-1 suite,
  including the non-vacuous property test: four different forged `X-Forwarded-For` prefixes from the same
  real client yield exactly ONE bucket (a bypass would yield four).
- The suite was extended to 18 cases in Lot 2 (CIDR mode, direct-peer rejection, throwing conn-info,
  IPv6). **That extended run is NOT locally verified**: `BR-XFF-N5` broke the workspace install before it
  could be re-run, and repair attempts failed the same way. **CI is the gate for the extended suite.**
- To avoid pushing the hand-written parser unverified, the pure CIDR/IPv6 algorithm was extracted from
  the REAL source (types stripped, logic untouched) and exercised under node: **19/19 assertions PASS**,
  covering v4/v6 prefixes, boundaries, cross-family rejection, malformed IPs, out-of-range prefixes and
  IPv4-mapped normalization.
- `make typecheck-api` could not complete for the same `BR-XFF-N5` reason. The one error observed before
  the damage (`apple-provider.ts` TS2305 on `jose`) is NOT from this branch: the container had `jose`
  5.10.0 while `api/package.json` pins `^6.1.0` — a stale-workspace artifact.
- `make down ENV=test-xff` — stack removed.

## Notes
- Two atomic commits: the client-IP trust fix, then the IdP limiter fix — two distinct defects.
- `packages/cli/bin/stp.mjs` had its file mode flipped to 755 by a container run; reverted, as it is
  outside this branch's scope.
- The IdP and the product API now share ONE limiter module, so the two auth surfaces cannot silently
  drift apart again — which is how the IdP ended up unprotected in the first place.
