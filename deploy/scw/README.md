# Scaleway Kubernetes deployment (tenant)

This directory ships the tenant-owned manifests for the `sentropic` workload
on the shared **poc-k8s** Scaleway Kubernetes cluster
(<https://github.com/rhanka/poc-k8s>).

The **namespace, ResourceQuota, LimitRange, NetworkPolicy baseline** are owned
by the cluster operator and live in
[`poc-k8s/tenants/sentropic/`](https://github.com/rhanka/poc-k8s/tree/main/tenants/sentropic).
Apply them first; the Makefile in this repo will not create them.

## Files

- `10-rbac.yaml` — namespace-scoped ServiceAccount used by every Pod, with
  `imagePullSecrets: [{ name: sentropic-registry }]` so every Pod can pull
  from the SCW Container Registry.
- `15-networkpolicy.yaml` — workload-scoped ingress allowances for the
  tenant default-deny baseline: api -> postgres, api -> maildev, ui -> api.
- `20-postgres.yaml` — Postgres 17 StatefulSet + headless Service + 1Gi PVC on
  `scw-bssd` + ConfigMap (`POSTGRES_DB`, `POSTGRES_USER`).
- `30-api.yaml` — `sentropic-api` SCW Container Registry image + ClusterIP
  Service (port 8787) + non-secret ConfigMap.
- `40-ui.yaml` — `sentropic-ui` SCW Container Registry image + ClusterIP
  Service (port 5173) + placeholder ConfigMap for future overlays.
- `50-maildev.yaml` — dev SMTP capture Deployment + ClusterIP Service (1025
  SMTP, 1080 UI).
- `60-ingress.yaml` — optional Traefik Ingress with cert-manager TLS. Replace
  the placeholder hosts and apply with `SCW_INGRESS=1`.

## Prerequisites (cluster operator side, in `~/src/poc-k8s/`)

```bash
make kubeconfig                 # ~/.kube/poc.yaml
make apply-platform             # cert-manager + traefik labels
make apply-sentropic            # namespace + RQ + LimitRange + NetPol
```

The namespace pull secret is managed from this repo with:

```bash
make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
```

The target creates the `sentropic-registry` `dockerconfigjson` Secret in the
`sentropic` namespace. It reads `REGISTRY`, `DOCKER_USERNAME`, and either
`SCW_REGISTRY_TOKEN` or `DOCKER_PASSWORD` from `SCW_ENV_FILE`; it does not
print the secret value. Prefer a token with **read-only** access to the SCW
Container Registry. Rotate the token by re-running the target.

## Secret bundle (operator side, once)

Two namespace-scoped Secrets must exist before applying the manifests:

- `sentropic-postgres` — `POSTGRES_PASSWORD`.
- `sentropic-api` — `DATABASE_URL`, every `*_API_KEY`, `MAIL_USERNAME`,
  `MAIL_PASSWORD`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`.

The api and ui manifests target the `feat-deploy-poc-k8s` alias tag on
`rg.fr-par.scw.cloud/nc-reg/sentropic-api` and
`rg.fr-par.scw.cloud/nc-reg/sentropic-ui`. The `publish-{api,ui}-image`
jobs in `.github/workflows/ci.yml` push two tags per image: a
content-hash sha1 (immutable, used by `make publish-{api,ui}-image`) and a
floating branch alias (`feat-deploy-poc-k8s` on the BR-37 branch, `main`
after merge). `imagePullPolicy: Always` plus the post-publish
`deploy-k8s` CI job (`kubectl -n sentropic rollout restart
deployment/api deployment/ui`) guarantee Kubernetes picks up the latest digest
without any imperative `kubectl set image`. `make scw-bundle-secret`
reads `~/src/sentropic/.env` and creates both Secrets in-cluster,
replacing the previous version. Re-run after rotating a key.

## GitHub deploy secret (operator side, once)

The CI `deploy-k8s` job needs the GitHub Actions secret `KUBECONFIG_B64`.
Create or update it from the local cluster kubeconfig with:

```bash
make gh-k8s-secret KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make gh-k8s-secret-check ENV=test-feat-deploy-poc-k8s
```

The target base64-encodes `KUBECONFIG` in memory and pipes it to
`gh secret set`; it does not print the secret value or write it to disk.

## Deploy

```bash
make scw-bundle-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml SCW_INGRESS=1 ENV=test-feat-deploy-poc-k8s
```

## Smoke test

```bash
make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s

make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=api PORT=8787 &
curl http://localhost:8787/api/v1/health
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=ui PORT=5173 &
xdg-open http://localhost:5173
```

## Pause / resume

```bash
make -C ~/src/poc-k8s tenant-pause  TENANT=sentropic DEPLOY=api
make -C ~/src/poc-k8s tenant-pause  TENANT=sentropic DEPLOY=ui
make -C ~/src/poc-k8s tenant-resume TENANT=sentropic DEPLOY=api
make -C ~/src/poc-k8s tenant-resume TENANT=sentropic DEPLOY=ui
```

Postgres is a StatefulSet; pause it with
`kubectl -n sentropic scale statefulset/postgres --replicas=0`.

## Cleanup

```bash
make scw-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
```

This removes the workload (Deployments, Services, Secrets created here,
StatefulSet, ConfigMaps). The namespace, ResourceQuota, LimitRange and
NetworkPolicy stay (owned by poc-k8s).
