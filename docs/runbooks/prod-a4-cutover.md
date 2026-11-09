# Prod A4 cutover — bindings, prerequisites and acceptance

The prod namespace `sentropic` runs the canonical A4 procedure of [preprod-a4-cutover.md](preprod-a4-cutover.md) with the prod bindings below. Building this procedure does not authorize executing it: the owner's prod GO (train T3) names the frozen candidate, the immutable execution annex and the rollback limits. Nothing here is applied by continuous deployment; `deploy-preprod` never touches `sentropic`.

## Prod bindings

| Item | Preprod (done 2026-11-08) | Prod |
| --- | --- | --- |
| Make targets | `k8s-preprod-a4-{prepare,custody,action,verify}` | `k8s-prod-a4-{prepare,custody,action,verify}` (the target fixes `A4_TIER=prod`; it cannot be overridden) |
| Namespace | `sentropic-preprod` | `sentropic` |
| Owner inputs | `preprod-a4-authorization/1`, `preprod-a4-request/1`, `preprod-a4-execution/1` | `prod-a4-authorization/1`, `prod-a4-request/1`, `prod-a4-execution/1` |
| Custody evidence | `preprod-a4-snapshot/1`, `preprod-a4-rehearsal/2` | `prod-a4-snapshot/1`, `prod-a4-rehearsal/2` |
| Email-code HMAC ring | `email-code-hmac:v1:preprod:<fp16>` | `email-code-hmac:v1:prod:<fp16>`; the request field `emailCodeActiveKeyRef` names it and the checkpoint refuses any other live ring |
| Product verifier (import mapping) | `preprod.sentropic.sent-tech.ca`, `https://preprod.sentropic.sent-tech.ca` | `sent-tech.ca`, `https://sentropic.sent-tech.ca` |
| Public health probe | `https://preprod.sentropic.sent-tech.ca/api/v1/health` | `https://sentropic.sent-tech.ca/api/v1/health` |
| Verification middleware | `sentropic-preprod-a4-verification@kubernetescrd` | `sentropic-a4-verification@kubernetescrd` |
| Rendered A4 runtime | `overlays/preprod-a4` | `overlays/prod-a4` (same `components/a4-wiring` and `preprod/a4-runtime` code; the launcher derives the ring tier from the pod namespace) |
| S2S issuer / resource | `https://preprod.auth.sent-tech.ca` / `https://preprod.sentropic.sent-tech.ca` | `https://auth.sent-tech.ca` / `https://sentropic.sent-tech.ca` (`overlays/prod/patch-api-config.yaml`, read by the A4 release only) |

Every other rule of the canonical procedure applies unchanged: private 0600 inputs, digest-only output, dry-run first, the fence before any request, the strict rehearsal receipt, the exclusive checkpoint write, internal then restricted HTTP verification, then the nominated functional flow.

## Prerequisites before the owner GO

1. Train T1 merged on main and published as one candidate image: prod operator path (this runbook), first-member bootstrap, account-approve Job through the launcher, per-credential RP provenance and `replica-sync` `rpId` normalization, fail-closed `JWT_SECRET` plus the `SECRET_ENCRYPTION_KEY` re-encryption tool, OAuth consent with an optional tenant (A1, blocking), identity error surfacing, preprod auto-repin and the artifact data guard.
2. Train T1-ops (owner gate, Secret-Store writes): the prod `email-code-hmac` Secret holds `EMAIL_CODE_HMAC_KEY_ACTIVE` and `EMAIL_CODE_HMAC_KEY_ACTIVE_REF` (custody values `PROD_EMAIL_CODE_HMAC_KEY_ACTIVE` / `PROD_EMAIL_CODE_HMAC_KEY_ACTIVE_REF` in the central `.env`, by name only, written through the prod writer identity `K8S_EMAIL_CODE_HMAC_WRITER_PROD_KUBECONFIG_B64` per [email-code-hmac-cred-cycle.md](email-code-hmac-cred-cycle.md)), no PREVIOUS pair; `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` follow the order « re-encrypt the stored envelopes, then set the key, then delete the fallback »; the JWT rotation invalidates sessions and is planned with the owner. Rotation cycles are recorded with k8s.
3. Train T2 (owner + k8s gate): an isolated restore of the prod backup, boot of the exact candidate, import, D11 and the nominated functional authentication, producing a genuine `prod-a4-rehearsal/2` receipt (`candidateBootPassed`, `functionalAuthPassed`, `d11Passed` true; seven census hashes) and the measured budgets with their `qualificationReceiptRef`. The rehearsal also runs the A1 check: an immo user who is not a sentropic tenant member completes the claude.ai immo-mcp connector OAuth with `offline_access` on the restored copy.
4. Read-only tenant checks in `sentropic`, recorded privately: `cronjob/pgbackup` exists (otherwise `prepare A4_PHASE=inspect` fails with a fixed digest: `backup_path_invalid`); the `sentropic-pgbackup` Secret and bucket are readable by the template; the Traefik `Middleware` CRD resolves; the quota admits the extra PVC `sentropic-a4-custody` (20Gi `block-standard`); `sentropic-identity-budgets` is absent; the tenant kubeconfig (`K8S_TENANT_ADMIN_KUBECONFIG_B64`, identity `system:serviceaccount:sentropic:sentropic-admin`) can perform every annex verb in `sentropic` (`kubectl auth can-i`; prod write scope `unverified` at writing time).
5. The G7 IdP sync stays stopped: the waiting run 42151635258 (`bundle-prod`) is not approved, and `IDP_SYNC_SCHEDULE_ENABLED` is set to `false` by s-conductor or the owner before the fence, so no prod export starts during the cutover.

## Execution

Follow steps 1–12 and the verification section of the canonical procedure with the prod targets, for example:

- `make k8s-prod-a4-prepare A4_PHASE=inspect A4_KUBECONFIG_FILE=/private/tenant-kubeconfig ENV=test-prod-a4`
- `make k8s-prod-a4-action A4_ACTION=fence A4_DRY_RUN=1 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_AUTHORIZATION_FILE=/private/authorization.json A4_EXECUTION_FILE=/private/a4-execution.json A4_EXECUTION_SHA256=<annex sha256> ENV=test-prod-a4`
- `make k8s-prod-a4-custody A4_OPERATION=budgets A4_DRY_RUN=1 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json A4_BUDGETS_FILE=/private/budgets.json ENV=test-prod-a4`
- `make k8s-prod-a4-custody A4_OPERATION=wire A4_DRY_RUN=1 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-prod-a4`
- `make k8s-prod-a4-prepare A4_PHASE=checkpoint A4_DRY_RUN=1 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-prod-a4`
- `make k8s-prod-a4-verify A4_VERIFY_PHASE=internal A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-prod-a4`

Each write repeats its dry-run with `A4_DRY_RUN=0` only after review. The prod annex records the prod verbs only (`sentropic` namespace, prod middleware name, prod UI image).

## After the restricted verification

1. Cutover IaC change (one T3 PR, CI green, s-conductor merge): replace the « Preserve each live production image » patches of `overlays/prod` with the candidate API, IdP, artifact-content and UI digests, and switch `make k8s-deploy` to `overlays/prod-a4` (otherwise the next prod apply removes the A4 wiring and the API refuses to boot). Apply it only while the fence is held or after `resume`, never in between.
2. Account role: grant `admin_app` to the owner's prod account with `make cm-account-approve-job ... CM_ACCOUNT_APPROVE_JOB_NAMESPACE=sentropic ...` (actor = an existing active prod `admin_app` account distinct from the target; its existence in prod is `unverified`).
3. First-member bootstrap of tenant `sentropic` through the governed tool of `fix/cm-first-member-bootstrap`, for the nominative list approved by the owner.
4. Acceptance (A5): the owner signs in with kept sessions and no new second-factor prompt; an immo prod user who is not a sentropic member completes the claude.ai immo-mcp connector OAuth with `offline_access`; the sentropic MCP client still refuses a non-member.
5. Only then `resume` and `open-traffic`. G7 resumes later and separately: both tiers on A4, Q-IDP1 nominative list, `replica-sync` `rpId` normalization deployed, then the waiting run is resolved.

## Abort and rollback

As in the canonical procedure, with the prod pre-fence backup and the fenced snapshot of `sentropic` (bucket name from the prod `sentropic-pgbackup` Secret, by name only). The prod artifact flags stay `0` throughout; this cutover never drops `artifacts.*` (the CI artifact data guard refuses such a change).
