# T3 window — operator rules for the five-minute driver

These rules complete [prod-a4-cutover.md](prod-a4-cutover.md) for the window driver (`make k8s-t3-window`). They come from the isolated rehearsal r9 and are enforced by the driver where stated. They authorize nothing: the owner GO, the annex and the gates of the T3 plan still apply.

## Order before the fence

A legacy login can move the durable applicability projection: an admin login rewrites the default workspace row. The baseline is therefore only valid for the session state it was captured in.

1. Log in as the legacy witness on the product origin and store the session in `witness` of the CONFIG (`url` = product `/api/v1/me`, `cookie`, `expiresAt` beyond T0 + 2 h).
2. Capture the baseline: `make k8s-t3-qualify T3_ACTION=baseline T3_CONFIG=CONFIG ENV=test-t3-restore`. The action first calls the witness URL with the witness cookie and requires `200`, then reads the applicability SQL. The baseline file carries `witnessSha256`, the binding to that witness session. Without a live witness session it refuses (`baseline_witness_missing`, `baseline_witness_not_authenticated`) and writes nothing.
3. Capture the ACL receipt (`T3_ACTION=capture-acl`), build the receipt policy and the annex (the policy binds the baseline bytes), then run `make k8s-t3-preview`.
4. From the baseline capture until the fence: no admin login, no new witness login, no legacy API restart.

Enforcement:

| Check | Where | Refusal |
| --- | --- | --- |
| Baseline bound to the configured witness session | offline preflight (`k8s-t3-preview`, driver start) and W0, W2, W5 | `baseline_not_after_witness` |
| Durable projection and encrypted stores unchanged since the baseline | W0, before the fence | `baseline_stale_before_fence: applicability_drift:<hash>` |

A W0 refusal happens before any write: nothing is fenced, the driver exits 1 and records `refusalReason` in the state file. Capture the baseline again (steps 2 and 3, new policy and annex), then start a new attempt.

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
- The custodian keeps the API requests and limits except the CPU limit, `1500m`. Before the window, check read-only that the namespace admits it while the consumers are stopped: the CPU-limit quota must cover the database, the custodian and the backup Job together, and the LimitRange maximum must allow `1500m`.

## Full restore (OD-T3-7 contingency)

- The ACL catalogue hash no longer depends on the session `search_path`. A receipt captured by an earlier driver head uses the previous formula: capture it again before any attempt.
- Restore a dump on the PostgreSQL version that produced it. The tenant database image tag floats: a dump taken on 17.12 carries a column option that 17.11 refuses.
