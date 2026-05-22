# UAT — sentropic on the poc-k8s Kubernetes cluster

State of this branch (`feat/deploy-poc-k8s`) :

- New `deploy/scw/` tenant manifests (RBAC + Postgres StatefulSet + api/ui Deployments + optional Ingress).
- Updated `.github/workflows/ci.yml` publishing `sentropic-api` and `sentropic-ui` to the SCW Container Registry, then running the neutral `deploy-k8s` job on branch/main pushes.
- New Makefile targets `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-registry-secret`, `scw-status`, `scw-debug`, `scw-logs`, `scw-smoke`, `scw-api-netcheck`, `scw-email-smoke`.
- This UAT note.

## Prerequisites

1. **Cluster up** : `~/src/poc-k8s` bootstrapped, `~/.kube/poc.yaml` fetched.
   `make -C ~/src/poc-k8s apply-platform apply-sentropic` already done.
2. **Registry pull secret ready** : create an SCW IAM API key with read-only access to the SCW Container Registry, then run `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s`.
3. **GitHub kubeconfig secret ready** : create repository secret `KUBECONFIG_B64` with the base64 content of `~/.kube/poc.yaml`.
4. **`.env` populated** with at minimum: `POSTGRES_PASSWORD` (otherwise defaults to `app`), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`. For outbound email in the POC, prefer active `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, and `MAIL_FROM`; `MAIL_FROM` defaults to `no-reply@sent-tech.ca`. The legacy POC `.env` format with commented `#export MAIL_USERNAME=...` and `#export MAIL_PASSWORD=...` is also supported by `make scw-bundle-secret`; when those credentials are present and `MAIL_HOST` is absent, the target derives Scaleway TEM SMTP as `smtp.tem.scaleway.com:465` with `MAIL_SECURE=true`.

## Step-by-step UAT

### Operator handoff notes (2026-05-17)

- The next deploy target is the Sentropic app workload. Run the commands below
  from this BR-37 worktree.
- Session `session-sess-apr95chl` is no longer wanted and now absent from the
  cluster: pod, PVC, and auth Secret all return `NotFound`.
- The `sentropic` tenant baseline was applied on 2026-05-17: namespace,
  ResourceQuota, LimitRange, NetworkPolicy, and tenant ServiceAccount exist.
- The api/ui manifests target `rg.fr-par.scw.cloud/nc-reg/sentropic-api:feat-deploy-poc-k8s`
  and `rg.fr-par.scw.cloud/nc-reg/sentropic-ui:feat-deploy-poc-k8s`.
- Secrets were bundled on 2026-05-17 from the root `.env`: `sentropic-postgres`
  and `sentropic-api` exist in namespace `sentropic`.
- Remaining rollout gate: the namespace must have the `sentropic-registry`
  imagePullSecret before applying the workload.

```bash
# 0) sanity
make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
# expected: empty (or `No resources found` — the tenant namespace exists, the workload does not yet)

# 1) inject secrets from your local .env
make scw-bundle-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
# expected: "Secrets sentropic-postgres + sentropic-api ready in sentropic."

# 2) inject the SCW Registry pull secret
make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
# expected: "Image pull secret sentropic-registry ready in sentropic."

# 3) deploy
make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
# expected: "deployment.apps/api successfully rolled out", same for ui
# expected: kubectl get pods shows api, ui, and postgres-0 (1/1 each)

# 4) smoke-test the API
make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s

make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=api PORT=8787 &
PF_API=$!
sleep 3
curl http://localhost:8787/api/v1/health
# expected: 200, JSON {"status":"ok", ...}
kill $PF_API

# 5) smoke-test the UI
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=ui PORT=5173 &
sleep 3
curl -sIo /dev/null -w "%{http_code}\n" http://localhost:5173/
# expected: 200
# (open http://localhost:5173 in a browser if you want the full UI UAT)

# 6) smoke-test outbound email path from the k8s api
make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make scw-email-smoke KUBECONFIG=$HOME/.kube/poc.yaml SCW_EMAIL_SMOKE_TO=<recipient> ENV=test-feat-deploy-poc-k8s

```

## Expected resources after deploy

```
NAME                          READY  STATUS   RESTARTS  AGE
pod/api-...                   1/1    Running  0         ~30s
pod/postgres-0                1/1    Running  0         ~60s
pod/ui-...                    1/1    Running  0         ~30s

NAME                          READY  AGE
deployment.apps/api           1/1    ~30s
deployment.apps/ui            1/1    ~30s

NAME                          READY  AGE
statefulset.apps/postgres     1/1    ~60s

persistentvolumeclaim/data-postgres-0   Bound  1Gi   scw-bssd
```

## Live evidence (2026-05-20, updated 2026-05-22)

- `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s` created `sentropic-registry`.
- `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` rolled out api and ui successfully after:
  - aligning manifests to `rg.fr-par.scw.cloud/nc-reg/sentropic-{api,ui}:feat-deploy-poc-k8s`;
  - using `strategy: Recreate` for api/ui under the tight tenant quota;
  - adding workload NetworkPolicies for api -> postgres and ui -> api;
  - adding an api `startupProbe` so startup migrations are not killed by liveness.
- `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` showed api, ui, and postgres all `1/1` after the Maildev removal.
- `make scw-bundle-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s` re-bundled outbound email from the POC `.env` TEM entries and reported `host=smtp.tem.scaleway.com port=465 secure=true from=no-reply@sent-tech.ca auth=configured`.
- `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` restarted api/ui after the SMTP Secret update; rollout finished successfully.
- `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` returned:
  - `OK: api /api/v1/health`
  - `OK: ui /`
- `make scw-logs KUBECONFIG=$HOME/.kube/poc.yaml SCW_LOG_TAIL=120 ENV=test-feat-deploy-poc-k8s` showed startup migrations, index creation, server listen, and health checks without runtime errors.
- `make -C ~/src/poc-k8s tenant-status TENANT=sentropic ENV=test-feat-deploy-poc-k8s` reported quota within budget after Maildev removal: pods `3/8`, requests.cpu `230m/300m`, requests.memory `448Mi/768Mi`, limits.cpu `1100m/1500m`, limits.memory `1152Mi/1500Mi`.
- Real email smoke to `fabien.antoine@gmail.com` reached the api but did not deliver. First `make scw-email-smoke ...` returned HTTP 500 and api logs showed `ENETUNREACH` to the Scaleway TEM IPv6 endpoint. After adding `NODE_OPTIONS=--dns-result-order=ipv4first` and redeploying, `make scw-email-smoke ...` still returned HTTP 500 and logs showed SMTP `Connection timeout` to `smtp.tem.scaleway.com:465`.
- `make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` returned `ETIMEDOUT` for `smtp.tem.scaleway.com:465`.
- `make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml SCW_NETCHECK_PORT=587 ENV=test-feat-deploy-poc-k8s` returned `ETIMEDOUT` for `smtp.tem.scaleway.com:587`.
- `make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml SCW_NETCHECK_HOST=51.159.84.239 SCW_NETCHECK_PORT=465 ENV=test-feat-deploy-poc-k8s` timed out against the direct Scaleway TEM IPv4 address.
- `make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml SCW_NETCHECK_HOST=api.scaleway.com SCW_NETCHECK_PORT=443 ENV=test-feat-deploy-poc-k8s` returned `OK`, proving external HTTPS egress works from the pod while SMTP egress is blocked.

Quota usage (`kubectl -n sentropic describe resourcequota tenant-quota`) should show ~230m / 448Mi requests used out of 300m / 768Mi authorised.

## Known limitations

- **No Ingress applied by default.** Use port-forward via `poc-k8s` `tenant-port-forward` for the UAT. To expose publicly, set up cert-manager + a `letsencrypt` ClusterIssuer, edit the placeholder hosts in `deploy/scw/60-ingress.yaml`, and apply with `SCW_INGRESS=1`.
- **Postgres has no backup automation.** A 1Gi PVC is enough for POC traffic but data is not snapshotted yet.
- **No Maildev in Kubernetes.** Outbound email uses the POC SMTP configuration stored in `SCW_ENV_FILE` and injected into the `sentropic-api` Secret. If `MAIL_HOST` is absent and POC TEM credentials cannot be recovered, the API starts with outbound email disabled rather than falling back to Maildev.
- **Outbound SMTP is blocked from the POC pod.** Real delivery through Scaleway TEM SMTP cannot pass until cluster egress to SMTP ports is opened/routed, or the email path is moved to a non-SMTP TEM relay/API.
- **Secrets bundling is operator-side** : every developer who wants to redeploy has to have a viable `~/src/sentropic/.env`. No Sealed Secrets / Vault yet.

## Cleanup

```bash
make scw-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
# the namespace + RQ + LimitRange + NetworkPolicy stay (owned by poc-k8s)
```
