# T3 window — operator rules for the five-minute driver

These rules complete [prod-a4-cutover.md](prod-a4-cutover.md) for the window driver (`make k8s-t3-window`). They come from the isolated rehearsal r9 and are enforced by the driver where stated. They authorize nothing: the owner GO, the annex and the gates of the T3 plan still apply.

## Order before the fence

A legacy login can move the durable applicability projection: an admin login rewrites the default workspace row. The baseline is therefore only valid for the session state it was captured in.

1. Log in as the legacy witness on the product origin and store the session in `witness` of the CONFIG (`url` = product `/api/v1/me`, `cookie`, `expiresAt` beyond T0 + 2 h).
2. Capture the baseline: `make k8s-t3-qualify T3_ACTION=baseline T3_CONFIG=CONFIG ENV=test-t3-restore`. The action first calls the witness URL with the witness cookie and requires `200`, then reads the applicability SQL. The baseline file carries `witnessSha256`, the binding to that witness session. Without a live witness session it refuses (`baseline_witness_missing`, `baseline_witness_not_authenticated`) and writes nothing.
3. Capture the ACL receipt (`T3_ACTION=capture-acl`), build the receipt policy and the annex (the policy binds the baseline bytes).
4. Provision the verification boundary Secret (next section), then run `make k8s-t3-preview`.
5. From the baseline capture until the fence: no admin login, no new witness login, no legacy API restart.

Enforcement:

| Check | Where | Refusal |
| --- | --- | --- |
| Baseline bound to the configured witness session | offline preflight (`k8s-t3-preview`, driver start) and W0, W2, W5 | `baseline_not_after_witness` |
| Durable projection and encrypted stores unchanged since the baseline | W0, before the fence | `baseline_stale_before_fence: applicability_drift:<hash>` |
| Verification credential present and well formed | offline preflight | `verification_credential_missing`, `verification_credential_invalid` |
| Cluster Secret `a4-verification-auth` is the verifier of the local credential | W0, before the fence | `verification_secret_missing`, `verification_secret_mismatch` |

A W0 refusal happens before any write: nothing is fenced, the driver exits 1 and records `refusalReason` in the state file. Capture the baseline again (steps 2 and 3, new policy and annex), then start a new attempt.

## Verification boundary

The load balancer in front of Traefik runs with `externalTrafficPolicy: Cluster` and no proxy protocol: Traefik sees a node address for every client. A source-range rule (`ipAllowList` with the operator `/32`) can therefore never match, and it is refused by the annex validation. The boundary is a credential.

- Annex `middlewareSpec`: exactly `{ "basicAuth": { "secret": "a4-verification-auth", "removeHeader": true } }`. The Secret is referenced by name; `removeHeader` keeps the credential away from the workloads.
- CONFIG `verificationCredentialFile`: path of a private 0600 file holding one line `user:password` (password of 32 to 1024 printable characters). The value is never printed, logged or passed on a command line.
- Provision, once per namespace and before the preview: `make k8s-t3-maintenance T3_ACTION=verification-secret T3_CONFIG=CONFIG T3_STATE_DIR=DIR A4_DRY_RUN=0 ENV=test-t3-restore`. It writes the credential file when it does not exist yet (random, 0600), then replaces Secret `a4-verification-auth` with one key `users` holding only the SHA-1 verifier (htpasswd form), sent on stdin. It refuses while `Middleware/a4-verification` exists (`verification_boundary_active`). Rotation: run it again with a new file; delete the Secret after the window is accepted.
- During W8 the driver sends the credential on S-3 to S-9 only. The observers S-1 and S-2 are sent without it and must meet the proxy refusal: status **401** with a `WWW-Authenticate: Basic` challenge. Traefik basicAuth answers 401, not 403; the challenge proves that Traefik answered, so an application 401, a 403 and an open route are all refused (`probe_failed: S-1`, `probe_failed: S-1 boundary_challenge`). In the CONFIG, `restrictedProbes` S-1 and S-2 carry `expect: 401`.
- A middleware whose Secret is missing is not built by Traefik and its routers answer 404: W0 refuses that state before the fence.

## Probe URLs

The driver refuses any other path before the fence (`probe_path_unqualified: <id>`), and requires one origin per group (`probe_origin_mixed`).

| Probe | Origin | Path |
| --- | --- | --- |
| S-3 | product | `/api/v1/health` |
| S-4 | IdP | `/.well-known/openid-configuration` |
| S-5 | IdP | `/.well-known/jwks.json` |
| S-6 | IdP | `/api/v1/auth/oauth/authorize` |
| S-7 | product | `/api/v1/me` |
| S-8 | IdP | `/api/v1/auth/me` |
| S-9a | product | `/api/v1/auth/email/verify-request` |
| S-9b | IdP | `/api/v1/auth/email/verify-request` |

On the candidate the product origin answers 404 on `/api/v1/auth/me`, and both origins answer 404 on `/api/v1/auth/email/send-code`. `usable-auth` uses the S-7 and S-8 URLs.

## After the fence

- The fence returns as soon as the Deployments are scaled, but the legacy `api` and `auth-idp` pods stay Terminating for their whole grace period (Node as PID 1 ignores SIGTERM). At the end of W3 the driver waits for zero `api`, `auth-idp` and `ui` pods, inside the W3 cutoff. A pod that never leaves routes to the pre-commit rollback. The wait is recorded as `writersGone` in the chronometer file.
- Scheduling: the prod wire names PriorityClass `sentropic-t3-critical` on the `api`, `auth-idp` and `ui` templates (the same field `overlays/prod-a4` renders, so P-0.8 stays at zero) and the driver names it on the custodian. The class gives queue priority only, never preemption, and acts only on pods that name it. A pod naming a class that does not exist is refused at creation: a missing class stops the window at W4, before COMMIT. The pods of a rollback run the legacy templates, without the class.
- The custodian keeps the API requests and limits except the CPU limit, `1500m`. Before the window, check read-only that the namespace admits it while the consumers are stopped: the CPU-limit quota must cover the database, the custodian and the backup Job together, and the LimitRange maximum must allow `1500m`.

## Full restore (OD-T3-7 contingency)

- The ACL catalogue hash no longer depends on the session `search_path`. A receipt captured by an earlier driver head uses the previous formula: capture it again before any attempt.
- PostgreSQL version: the backup job dumps with a client pinned to 17.11. Under a 17.12 server that client writes `ALTER COLUMN … SET (pg_attver=…)` statements, which a 17.11 server refuses; server and client on the same pinned minor write none. Check both sides, read-only, on the fixture and on prod: `make k8s-t3-qualify T3_ACTION=postgres-version T3_CONFIG=CONFIG ENV=test-t3-restore` requires server version 17.11, the pod imageID of the pinned prod bytes and the pinned dump client (`postgres_version_unqualified` otherwise).

## Isolated fixture

- The generator (`T3_ACTION=fixture`) adds the pod labels the platform NetworkPolicies of `sentropic-restore-a4` select, next to the prod labels: `component: ui`, `component: auth-idp` (Traefik ingress) and `component: backup-download` on the backup job; on the restore tier the driver gives the custodian `component: backup-download`. No labelling loop is needed.
- The generator names the T3 priority class on the three Deployments and pins the database to the prod server bytes (`postgres@sha256:266d3c25…`, 17.11). It refuses an inventory whose postgres images are not on the 17.11 pins (`fixture_postgres_unpinned`). A database volume initialised by another minor must be recreated before the legacy copy is loaded.
- The live prod StatefulSet still names the floating tag `postgres:17-alpine`. Applying `overlays/prod-a4` changes that image string to the digest and restarts `postgres-0` on the same 17.11 bytes; P-0.8 judges the three Deployments only, so plan that restart.
