# T3 window — operator rules for the five-minute driver

These rules complete [prod-a4-cutover.md](prod-a4-cutover.md) for the window driver (`make k8s-t3-window`). They come from the isolated rehearsal r9 and are enforced by the driver where stated. They authorize nothing: the owner GO, the annex and the gates of the T3 plan still apply.

## Order before the fence

A legacy login can move the durable applicability projection: an admin login rewrites the default workspace row. The baseline is therefore only valid for the session state it was captured in.

1. On `prod` (`sentropic`), before capturing receipts (owner prod act outside the window, `suspend: true` preserved): apply `kubectl apply -k deploy/k8s/overlays/prod/idp-identity-sync` so `CronJob/sentropic-idp-identity-export` carries `initContainers[0].name = "export-sql"`. The driver never applies this overlay itself and refuses T0 when `initContainers[0].name !== "export-sql"`.
2. Log in as the legacy witness on the product origin and store the session in `witness` of the CONFIG (`url` = product `/api/v1/me`, `cookie`, `expiresAt` beyond T0 + 2 h).
3. Capture the baseline: `make k8s-t3-qualify T3_ACTION=baseline T3_CONFIG=CONFIG ENV=test-t3-restore`. The action first calls the witness URL with the witness cookie and requires `200`, then reads the applicability SQL. The baseline file carries a salted `witnessSha256` (`witnessSalt` + HMAC-SHA256), the binding to that witness session. Without a live witness session it refuses (`baseline_witness_missing`, `baseline_witness_not_authenticated`) and writes nothing.
4. Capture the ACL receipt (`T3_ACTION=capture-acl`), the PostgreSQL version receipt (`T3_ACTION=postgres-version`, writing `postgresVersionFile` with `identityExportInitContainer: "export-sql"`), and the legacy pod-template digests (`legacySha256` from `T3_ACTION=template-diff`, stored as `templateDigests` `{ api, "auth-idp", ui }` in the CONFIG), then build the receipt policy and the annex (the policy binds the baseline bytes).
5. Provision the verification boundary Secret (next section), then run `make k8s-t3-preview`.
6. From the baseline capture until the fence: no admin login, no new witness login, no legacy API restart.

Enforcement:

| Check | Where | Refusal |
| --- | --- | --- |
| Baseline bound to the configured witness session | offline preflight (`k8s-t3-preview`, driver start) and W0, W2, W5 | `baseline_not_after_witness` |
| Durable projection and encrypted stores unchanged since the baseline | W0, before the fence | `baseline_stale_before_fence: applicability_drift:<hash>` |
| ACL receipt formula matches current `t3-acl.sql` | offline preflight | `acl_baseline_invalid` |
| PostgreSQL 17.11 server, backup/export client pins, and `CronJob/sentropic-idp-identity-export` `initContainers[0].name === "export-sql"` | `T3_ACTION=postgres-version`, offline preflight (`postgresVersionFile`) and W0 (live `SHOW server_version`, `postgres-0` `imageID`, `pgbackup` and `sentropic-idp-identity-export` `export-sql` container + client images) | `identity_export_init_container_invalid`, `postgres_version_receipt_invalid`, `postgres_version_unqualified` |
| Legacy Deployment pod-template digests recorded and unchanged | offline preflight (`templateDigests`) and W0, before the fence | `template_digest_missing`, `template_digest_stale_before_fence: <deploy>` |
| Verification credential present and well formed | offline preflight | `verification_credential_missing`, `verification_credential_invalid` |
| Cluster Secret `a4-verification-auth` is the verifier of the local credential | W0, before the fence (including `--dry-run --probe-readonly`) | `verification_secret_missing`, `verification_secret_mismatch` |
| Server-side admission (`--dry-run=server`) of `priorityClassName: sentropic-t3-critical` | W0, before the fence on `prod` and `restore` | `priority_class_unadmitted` |

A W0 refusal happens before any write: nothing is fenced, the driver exits 1 and records `refusalReason` in the state file. Capture the baseline again (steps 2 and 3, new policy and annex), then start a new attempt.

## Verification boundary

The load balancer in front of Traefik runs with `externalTrafficPolicy: Cluster` and no proxy protocol: Traefik sees a node address for every client. A source-range rule (`ipAllowList` with the operator `/32`) can therefore never match, and it is refused by the annex validation. The boundary is a credential.

- Annex `middlewareSpec`: exactly `{ "basicAuth": { "secret": "a4-verification-auth", "removeHeader": true } }`. The Secret is referenced by name; `removeHeader` keeps the credential away from the workloads.
- CONFIG `verificationCredentialFile`: path of a private 0600 file holding one line `user:password` (password of 32 to 1024 printable characters). The value is never printed, logged or passed on a command line.
- Provision, once per namespace and before the preview: `make k8s-t3-maintenance T3_ACTION=verification-secret T3_CONFIG=CONFIG T3_STATE_DIR=DIR A4_DRY_RUN=0 ENV=test-t3-restore`. It writes the credential file when it does not exist yet (random, 0600), then replaces Secret `a4-verification-auth` with one key `users` holding only the SHA-1 verifier (htpasswd form), sent on stdin. It refuses while `Middleware/a4-verification` exists (`verification_boundary_active`). Rotation: run it again with a new file; delete the Secret after the window is accepted.
- During W8 the driver sends the credential on S-3 to S-9 only. The observers S-1 and S-2 are sent without it and must meet the proxy refusal: status **401** with a `WWW-Authenticate: Basic` challenge. Traefik basicAuth answers 401, not 403; the challenge proves that Traefik answered, so an application 401, a 403 and an open route are all refused (`probe_failed: S-1`, `probe_failed: S-1 boundary_challenge`). In the CONFIG, `restrictedProbes` S-1 and S-2 carry `expect: 401`.
- HTTP probes that immediately follow a Traefik Ingress/Middleware mutation (`S-1`/`S-2` and `E-1`/`E-2` in `t3-finish-open.mjs`, and `verifyService` in `t3-rollback.mjs`) apply a bounded `<= 3 s` EndpointSlice/router propagation retry inside the existing step and window deadlines (`TRAEFIK_SYNC_MS = 3000`). Only transport errors and the transient stale-route signature (`404`/`502`/`503` without JSON, or residual `401 Basic` right after middleware deletion) are retried; real refusals (`200` on `S-1`/`S-2`, application `401`, `403`, `500`, redirects) fail immediately on attempt 1.
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
- Scheduling: the prod wire names PriorityClass `sentropic-t3-critical` on the `api`, `auth-idp` and `ui` templates (the same field `overlays/prod-a4` renders, so P-0.8 stays at zero) and the driver names it on the custodian. The class gives queue priority only, never preemption, and acts only on pods that name it. W0 checks server-side pod admission (`--dry-run=server`) for `sentropic-t3-critical` before the fence (`priority_class_unadmitted`). `preCommitRollback` (`t3-rollback.mjs`, `t3-emergency.sh`, `T3_ACTION=restore`) targets `templateDigests` rather than revision numbers: when a Deployment's normalized `spec.template` already matches the recorded digest, it skips `rollout undo` (idempotent across repeated rollback/emergency invocations after `rollout undo` renumbers revisions); otherwise it resolves the live `ReplicaSet` revision by normalized pod-template digest (`rollback_template_not_found`, `rollback_template_mismatch`).
- The custodian keeps the API requests and limits except the CPU limit, `1500m`. Before the window, check read-only that the namespace admits it while the consumers are stopped: the CPU-limit quota must cover the database, the custodian and the backup Job together, and the LimitRange maximum and `maxLimitRequestRatio` (1500m limit over 100m inherited request = 15) must allow `1500m`.
- W8 frontal startup (`t3-finish-open.mjs`): `ui` and `auth-idp` scale up and await rollout concurrently (including on post-commit resume), aborting the sibling rollout process group immediately on first failure and routing to `recover()`. All S-checks (`S-1`, `S-2`, then `S-3`..`S-9b`) and post-acceptance steps (`ACCEPTED` -> `BACKUP_RESUMED` -> `ONE_HOST_OPEN` -> `TWO_HOSTS_OPEN` -> `externalProbes`) execute in strict sequential order only after both Deployments are ready.
- API-server TCP dial resilience (`t3-kubectl-proxy.mjs`): every `kubectl` runner (`guards.kubectl`, `runKubectl` sync/async, and `delivered` entry points; independent supervised Worker in `t3-watchdog.mjs`) dials the active kubeconfig `server` (strictly allowlisted on `CONNECT`, `403 Forbidden` otherwise; client socket paused during dial) through an in-process loopback `HTTP CONNECT` tunnel with `KUBECTL_DIAL_TIMEOUT_MS = 2000` (`<= 3 s`) and up to 3 attempts strictly before writing `HTTP/1.1 200 Connection Established` (measured median overhead `+0.82 ms` to `+1.01 ms` per call, `~0.16 s` across ~160 calls). A shared `proxyConnects` counter is recorded in `t3-chrono.jsonl` (`summarize()` top-level `proxyConnects`) and verified at the end of W0 before `t0` (`kubectl_proxy_unverified`), or traced explicitly as `dialProxy: bypassed(<reason>)` when overridden by `T3_KUBECTL_PROXY_DISABLE=1` (`disabled`, emergency kill-switch forcing direct `kubectl` dials), an external `HTTPS_PROXY` (`https_proxy`), `NO_PROXY` (`no_proxy`), or a kubeconfig `proxy-url` (`kubeconfig_proxy_url`). Worker `error`/`exit` and `server.on('error')` purge the Worker cache and raise `kubectl_proxy_down` in nominal steps, while `recover()` and `t3-watchdog.mjs` fall back automatically to direct dials. Once `200 Connection Established` is returned, mid-stream TLS/HTTP/WebSocket/SPDY failures are never retried (`W7b` `kubectl exec -i postgres-0` retries only when TCP never connected; any mid-stream failure routes to `recover()`).
- Cold Cinder attach: pre-T0 warm attach or pre-placement of `sentropic-a4-custody` or `auth-idp-session-authority` is intentionally not implemented because modifying `Deployment/api` pre-T0 triggers a pre-fence rolling update, while a separate RWO helper pod either collides with `custodian` RW access in W4–W6, risks `Multi-Attach` delays on unpinned `auth-idp` in W8, or consumes the `sentropic` pod quota.
- Pre-commit rearm (`make k8s-t3-maintenance T3_ACTION=rearm`): `Pod/sentropic-a4-rearm` sets `terminationGracePeriodSeconds: 1`, `priorityClassName: sentropic-t3-critical` on `prod` and `restore` tiers (aligned with `prioritized(tier)`, omitted on `preprod`), and a PID 1 `SIGTERM`/`SIGINT` exit-0 handler (`delete pod --timeout=30s` unchanged). When `T3_CHRONO_FILE` is unset, rearm `kubectl` chronometer entries route to `rearm-chrono.jsonl` inside the archive so the fresh `stateDir` stays clean across replays. The sequence (`custody.tar.gz` + `custody.manifest` + `custody.sha256` -> subset manifest check on resume -> `.custody-emptied` PVC wipe -> delete `pgbackup-a4-*` Jobs -> rename `operator-state`) is idempotent and resumable across interruptions (including partial or completed PVC wipes before `.custody-emptied`): on resume before `.custody-emptied`, every live `/run/cm-cutover` entry must match a line of `custody.manifest` (`rearm_custody_pvc_mismatch` on any modified or added entry), while a pre-R12 archive lacking `custody.manifest` is accepted only if `/run/cm-cutover` is already empty and refused otherwise with `rearm_manifest_missing`.

## Full restore (OD-T3-7 contingency)

- The ACL catalogue hash no longer depends on the session `search_path`. Offline preflight rejects receipts captured with an earlier formula (`aclFormulaSha256`): capture it again before any attempt.
- PostgreSQL version: the backup and identity-export jobs dump with a client pinned to 17.11. Under a 17.12 server that client writes `ALTER COLUMN … SET (pg_attver=…)` statements, which a 17.11 server refuses; server and client on the same pinned minor write none. Run `make k8s-t3-qualify T3_ACTION=postgres-version T3_CONFIG=CONFIG ENV=test-t3-restore` to verify server version 17.11, the pod `imageID` of the pinned prod bytes and the pinned `pgbackup` and `sentropic-idp-identity-export` client images (`postgres_version_unqualified` otherwise) and write `postgresVersionFile`; both offline preflight and W0 enforce it before the fence.

## Isolated fixture

- The generator (`T3_ACTION=fixture`) adds the pod labels the platform NetworkPolicies of `sentropic-restore-a4` select, next to the prod labels: `component: ui`, `component: auth-idp` (Traefik ingress) and `component: backup-download` on the backup job; on the restore tier the driver gives the custodian `component: backup-download`. No labelling loop is needed.
- The generator names the T3 priority class on the three Deployments and pins the database to the prod server bytes (`postgres@sha256:266d3c25…`, 17.11). It refuses an inventory whose postgres images are not on the 17.11 pins (`fixture_postgres_unpinned`). A database volume initialised by another minor must be recreated before the legacy copy is loaded.
- The live prod StatefulSet still names the floating tag `postgres:17-alpine`. Applying `overlays/prod-a4` changes that image string to the digest and restarts `postgres-0` on the same 17.11 bytes; P-0.8 judges the three Deployments only, so plan that restart.
