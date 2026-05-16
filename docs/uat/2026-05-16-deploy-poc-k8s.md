# UAT — sentropic on the poc-k8s Kapsule cluster

State of this branch (`feat/deploy-poc-k8s`) :

- New `deploy/scw/` tenant manifests (RBAC + Postgres StatefulSet + api/ui Deployments + maildev + optional Ingress).
- New `.github/workflows/build-and-push-images.yml` building `top-ai-ideas-api` and `top-ai-ideas-ui` to GHCR on every tag `v*` and every push to this branch / `main`.
- New Makefile targets `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-status`.
- This UAT note.

## Prerequisites

1. **Cluster up** : `~/src/poc-k8s` bootstrapped, `~/.kube/poc.yaml` fetched.
   `make -C ~/src/poc-k8s apply-platform apply-sentropic` already done.
2. **Images public on GHCR** : after the first workflow run, toggle
   <https://github.com/users/rhanka/packages/container/top-ai-ideas-api/settings>
   and `…/top-ai-ideas-ui/settings` to "Public" (one click each).
3. **`.env` populated** with at minimum: `POSTGRES_PASSWORD` (otherwise defaults to `app`), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MAIL_USERNAME`, `MAIL_PASSWORD`. Other keys are optional and only needed for the features that depend on them.

## Step-by-step UAT

```bash
# 0) sanity
KUBECONFIG=~/.kube/poc.yaml kubectl -n sentropic get all
# expected: empty (or `No resources found` — the tenant namespace exists, the workload does not yet)

# 1) inject secrets from your local .env
KUBECONFIG=~/.kube/poc.yaml make scw-bundle-secret
# expected: "Secrets sentropic-postgres + sentropic-api ready in sentropic."

# 2) deploy
KUBECONFIG=~/.kube/poc.yaml make scw-deploy
# expected: "deployment.apps/api successfully rolled out", same for ui
# expected: kubectl get pods shows api, ui, maildev (1/1 each) + postgres-0 (1/1)

# 3) smoke-test the API
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=api PORT=8787 &
PF_API=$!
sleep 3
curl http://localhost:8787/api/v1/health
# expected: 200, JSON {"status":"ok", ...}
kill $PF_API

# 4) smoke-test the UI
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=ui PORT=5173 &
sleep 3
curl -sIo /dev/null -w "%{http_code}\n" http://localhost:5173/
# expected: 200
# (open http://localhost:5173 in a browser if you want the full UI UAT)

# 5) smoke-test maildev (optional)
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

Quota usage (`kubectl -n sentropic describe resourcequota tenant-quota`) should show ~260m / 512Mi requests used out of 300m / 768Mi authorised.

## Known limitations

- **No Ingress applied by default.** Use port-forward via `poc-k8s` `tenant-port-forward` for the UAT. To expose publicly, set up cert-manager + a `letsencrypt` ClusterIssuer, edit the placeholder hosts in `deploy/scw/60-ingress.yaml`, and apply with `SCW_INGRESS=1`.
- **Postgres has no backup automation.** A 1Gi PVC is enough for POC traffic but data is not snapshotted yet.
- **`maildev` is dev-only** : real outbound SMTP is not configured. Tests that rely on outgoing email work only against the maildev UI capture.
- **Secrets bundling is operator-side** : every developer who wants to redeploy has to have a viable `~/src/sentropic/.env`. No Sealed Secrets / Vault yet.

## Cleanup

```bash
KUBECONFIG=~/.kube/poc.yaml make scw-undeploy
# the namespace + RQ + LimitRange + NetworkPolicy stay (owned by poc-k8s)
```
