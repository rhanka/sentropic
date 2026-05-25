# BR-37b — Live UAT log on `poc-k8s` (sentropic tenant)

Branch: `feat/deploy-poc-k8s-37b` (HEAD as of this entry: `1367b60e`).
Cluster: Scaleway Kapsule `poc-k8s`, namespace `sentropic`.
Operator: Fabien Antoine.

## Lot 0 — Baseline (2026-05-24)

### Cluster snapshot
- `pod/api-7cb67ddd49-748m4` 1/1 Running 15h, node `scw-poc-burst-1250f20a3786425195a8a8a37027bafc`, IP `100.64.3.197`.
- `pod/postgres-0` 1/1 Running 22h, IP `100.64.3.115`.
- `pod/ui-7bfc49647f-bds7x` 1/1 Running 15h, IP `100.64.3.251`.
- `service/api` ClusterIP `10.32.10.123:8787`, `service/postgres` headless `:5432`, `service/ui` ClusterIP `10.32.13.60:5173`. Ages 3d8h-3d11h.
- `deployment.apps/api` 1/1, `deployment.apps/ui` 1/1, `statefulset.apps/postgres` 1/1.

### NetworkPolicies in `sentropic`
- `default-deny-ingress` (deny ingress, applies to all pods, ingress-only).
- `allow-api-to-postgres` (ingress 5432 from `app.kubernetes.io/component=api` to postgres pod, ingress-only).
- `allow-ui-to-api` (ingress 8787 from ui to api, ingress-only).
- **No NetworkPolicy of type `egress` exists** in the tenant; egress is unconstrained from the namespace's perspective.

### SMTP egress netcheck matrix (from `deploy/api` pod, `SCW_NETCHECK_TIMEOUT=8000`)
- `smtp.tem.scaleway.com:465` → `ETIMEDOUT` after **370 ms** (kernel-level drop, not TCP retransmission timeout).
- `smtp.tem.scaleway.com:587` → `ETIMEDOUT` after **360 ms** (same pattern).
- `51.159.84.239:465` (Scaleway TEM IPv4 direct) → `timed out` after **8000 ms** (full Node socket setTimeout).
- `smtp.gmail.com:465` → `ETIMEDOUT` after **295 ms** (kernel-level drop on third-party SMTP too).
- `api.scaleway.com:443` (control HTTPS) → `OK` in **32-39 ms**.

### Conclusion
- Outbound SMTP is blocked at the Kapsule **platform** level (not in our namespace policies). HTTPS to Scaleway API is reachable.
- Path A (egress NetworkPolicy) cannot unblock SMTP — there is nothing to allow on our side.
- Mandatory remediation: migrate the application from Nodemailer SMTP to **Scaleway TEM HTTP API** (POST `/transactional-email/v1alpha1/regions/fr-par/emails`).

## Lot 1.1 — IAM scope extension (2026-05-24)

### Existing identity reused
- IAM Application: `sent-tech-mail`, id `b898a07e-29cf-46b2-ba8f-d20916157c78`.
- API Key: access key `SCWR1Z91RNSWVT9GC8PH`, currently bound to `MAIL_ACCESS_KEY` (= access key) and `MAIL_PASSWORD` (= secret key) commented in root `.env`.
- IAM Policy: `sent-tech-mail`, id `1a7a2ec3-f5cd-444e-9db4-f0d524da936d`.
- Project scope: `PoCs`, id `09ac728a-e3b9-4a5b-9749-664b0f147c70` (== `SCW_DEFAULT_PROJECT_ID`).
- Region: `fr-par`.
- Validated sender domain on TEM: `sent-tech.ca`.

### Policy change applied via Scaleway console (Playwright session)
- Rule #1 — scope `PoCs` unchanged.
- Permission sets BEFORE: `TransactionalEmailEmailSmtpCreate` only.
- Permission sets AFTER: `TransactionalEmailEmailSmtpCreate` + `TransactionalEmailEmailApiCreate`.
- No new IAM Application, no new secret key created. Strict additive change.
- Wizard steps executed: edit Rule #1 → Validate scope → expand `Domains & Web Hosting` → check `TransactionalEmailEmailApiCreate` → Validate permissions → Validate CEL condition (empty) → modal closes. Server state reflects the second permission immediately.

### Live smoke validation
- `curl -X POST -H "X-Auth-Token: <secret>" https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails` with body `{from:no-reply@sent-tech.ca, to:fabien.antoine@gmail.com, project_id:<PoCs>, subject:"BR37b TEM API smoke (post-step3 commit)", text:"..."}` → HTTP 200.
- Returned `id` = `21c9fc5d-56df-46c2-9e12-580ef531bcc5`, `message_id` = `f8bacf0d-a6ef-400f-9812-808ec5e245b7`, `status` = `sending`, `status_details` = `ready to send`.
- Mail delivery confirmed in the operator inbox (`fabien.antoine@gmail.com`) immediately after the call. Subject line received: `BR37b TEM API smoke (post-step3 commit)`, body: `Test API send after going through CEL step. 2026-05-24T20:17:57Z.`

### Decision recorded
- Reuse the existing secret key for the new HTTP API client. No procurement of a new credential; reduces surface area.
- After the migration is complete and the SMTP code path is fully removed, the `TransactionalEmailEmailSmtpCreate` permission set may be removed from Rule #1 as a clean-up (separate IAM operation, deferred to a follow-up task).

## Pending UAT entries (to be filled by upcoming lots)
- Lot 1.2-1.10: code migration + Maildev mock + live `make scw-email-smoke` re-run from the api pod.
- Lot 2: Sealed Secrets controller install + `sentropic-api` / `sentropic-postgres` reconciled from `SealedSecret`.
- Lot 3: Postgres backup CronJob round-trip (bucket `sentropic-pgbackup`, mutualised DOC_STORAGE IAM).
- Lot 4: `sentropic.sent-tech.ca` Ingress + cert-manager DNS-01 via Cloudflare API token.
- Lot 5: end-to-end publish → deploy-k8s → rollout → smoke matrix.

## Lot 2 + Lot 1.9 — Sealed Secrets live (2026-05-25)

### Controller
- Installed Bitnami Sealed Secrets v0.37.0 in namespace `sealed-secrets` via `make scw-sealed-secrets-install`. `deployment/sealed-secrets-controller` 1/1 Running; CRD `sealedsecrets.bitnami.com` present.

### Sealing
- Built plaintext `sentropic-api` Secret from the live secret: kept the 11 non-mail keys, added `SCW_TEM_SECRET_KEY` (reusing the existing IAM secret key value, formerly `MAIL_PASSWORD`), dropped the 6 `MAIL_*` keys. Sealed via `make scw-seal-secret` → `deploy/scw/05-sealed-sentropic-api.yaml` (committed, encrypted).
- Sealed `sentropic-postgres` (POSTGRES_PASSWORD, value unchanged) → `deploy/scw/06-sealed-sentropic-postgres.yaml`.
- First apply failed with `Resource already exists and is not managed by SealedSecret` (the live secrets were created by `scw-bundle-secret`, not the controller). Resolved by deleting the unmanaged secrets and re-applying the SealedSecrets; the controller then owns + reconciles them. No running pod impacted (env injected at pod start; live email was already broken via SMTP egress).
- Reconciled state verified: `sentropic-api` = 12 keys incl. `SCW_TEM_SECRET_KEY`, **0** `MAIL_*`; `sentropic-postgres` = `POSTGRES_PASSWORD`.

### Lot 1.9 — manifest wiring
- `deploy/scw/30-api.yaml` ConfigMap `api` now sets non-secret `SCW_TEM_API_BASE_URL`, `SCW_TEM_REGION`, `SCW_TEM_PROJECT_ID` (`09ac728a-...`), `SCW_TEM_FROM_EMAIL`, `SCW_TEM_FROM_NAME`. `SCW_TEM_SECRET_KEY` flows from the `sentropic-api` SealedSecret via existing `envFrom: secretRef`. No `MAIL_*` anywhere.

### Lot 1.10 — GATED on merge
- The live api pod still runs image `:main` (pre-migration code expecting `MAIL_*`). The TEM HTTP API code only reaches the cluster once PR #176 merges to main and `publish-api-image` republishes `sentropic-api:main`, after which `deploy-k8s` rolls out the new pod consuming `SCW_TEM_SECRET_KEY`. Live `make scw-email-smoke` must be run POST-MERGE. Until then live email remains as-was (already non-functional via blocked SMTP). No regression introduced.
