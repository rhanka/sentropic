# UAT — sentropic on the poc-k8s Kubernetes cluster

State of this branch (`feat/deploy-poc-k8s`) :

- New `deploy/scw/` tenant manifests (RBAC + Postgres StatefulSet + api/ui Deployments + maildev + optional Ingress).
- Updated `.github/workflows/ci.yml` publishing `sentropic-api` and `sentropic-ui` to the SCW Container Registry, then running the neutral `deploy-k8s` job on branch/main pushes.
- New Makefile targets `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-registry-secret`, `scw-status`, `scw-debug`, `scw-logs`, `scw-smoke`.
- This UAT note.

## Prerequisites

1. **Cluster up** : `~/src/poc-k8s` bootstrapped, `~/.kube/poc.yaml` fetched.
   `make -C ~/src/poc-k8s apply-platform apply-sentropic` already done.
2. **Registry pull secret ready** : create an SCW IAM API key with read-only access to the SCW Container Registry, then run `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s`.
3. **GitHub kubeconfig secret ready** : create repository secret `KUBECONFIG_B64` with the base64 content of `~/.kube/poc.yaml`.
4. **`.env` populated** with at minimum: `POSTGRES_PASSWORD` (otherwise defaults to `app`), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MAIL_USERNAME`, `MAIL_PASSWORD`. Other keys are optional and only needed for the features that depend on them.

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
# expected: kubectl get pods shows api, ui, maildev (1/1 each) + postgres-0 (1/1)

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

# 6) smoke-test maildev (optional)
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=maildev PORT=1080 &
sleep 3
curl -sIo /dev/null -w "%{http_code}\n" http://localhost:1080/
# expected: 200 (the maildev UI)
```

## Expected resources after deploy

```
NAME                          READY  STATUS   RESTARTS  AGE
pod/api-...                   1/1    Running  0         ~30s
pod/maildev-...               1/1    Running  0         ~30s
pod/postgres-0                1/1    Running  0         ~60s
pod/ui-...                    1/1    Running  0         ~30s

NAME                          READY  AGE
deployment.apps/api           1/1    ~30s
deployment.apps/maildev       1/1    ~30s
deployment.apps/ui            1/1    ~30s

NAME                          READY  AGE
statefulset.apps/postgres     1/1    ~60s

persistentvolumeclaim/data-postgres-0   Bound  1Gi   scw-bssd
```

## Live evidence (2026-05-20)

- `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s` created `sentropic-registry`.
- `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` rolled out api and ui successfully after:
  - aligning manifests to `rg.fr-par.scw.cloud/nc-reg/sentropic-{api,ui}:feat-deploy-poc-k8s`;
  - using `strategy: Recreate` for api/ui under the tight tenant quota;
  - adding workload NetworkPolicies for api -> postgres, api -> maildev, ui -> api;
  - adding an api `startupProbe` so startup migrations are not killed by liveness.
- `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` showed api, ui, maildev, and postgres all `1/1`.
- `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` returned:
  - `OK: api /api/v1/health`
  - `OK: ui /`
  - `OK: maildev /`
- `make -C ~/src/poc-k8s tenant-status TENANT=sentropic ENV=test-feat-deploy-poc-k8s` reported quota within budget: pods `4/8`, requests.cpu `260m/300m`, requests.memory `512Mi/768Mi`, limits.cpu `1200m/1500m`, limits.memory `1280Mi/1500Mi`.

Quota usage (`kubectl -n sentropic describe resourcequota tenant-quota`) should show ~260m / 512Mi requests used out of 300m / 768Mi authorised.

## Known limitations

- **No Ingress applied by default.** Use port-forward via `poc-k8s` `tenant-port-forward` for the UAT. To expose publicly, set up cert-manager + a `letsencrypt` ClusterIssuer, edit the placeholder hosts in `deploy/scw/60-ingress.yaml`, and apply with `SCW_INGRESS=1`.
- **Postgres has no backup automation.** A 1Gi PVC is enough for POC traffic but data is not snapshotted yet.
- **`maildev` is dev-only** : real outbound SMTP is not configured. Tests that rely on outgoing email work only against the maildev UI capture.
- **Secrets bundling is operator-side** : every developer who wants to redeploy has to have a viable `~/src/sentropic/.env`. No Sealed Secrets / Vault yet.

## Cleanup

```bash
make scw-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
# the namespace + RQ + LimitRange + NetworkPolicy stay (owned by poc-k8s)
```
