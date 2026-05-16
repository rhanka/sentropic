# Scaleway Kapsule deployment (tenant)

This directory ships the tenant-owned manifests for the `sentropic` workload
on the shared **poc-k8s** Scaleway Kapsule cluster
(<https://github.com/rhanka/poc-k8s>).

The **namespace, ResourceQuota, LimitRange, NetworkPolicy baseline** are owned
by the cluster operator and live in
[`poc-k8s/tenants/sentropic/`](https://github.com/rhanka/poc-k8s/tree/main/tenants/sentropic).
Apply them first; the Makefile in this repo will not create them.

## Files

- `10-rbac.yaml` — namespace-scoped ServiceAccount used by every Pod.
- `20-postgres.yaml` — Postgres 17 StatefulSet + headless Service + 1Gi PVC on
  `scw-bssd` + ConfigMap (`POSTGRES_DB`, `POSTGRES_USER`).
- `30-api.yaml` — `top-ai-ideas-api` Deployment + ClusterIP Service (port 8787)
  + non-secret ConfigMap.
- `40-ui.yaml` — `top-ai-ideas-ui` Deployment + ClusterIP Service (port 5173)
  + placeholder ConfigMap for future overlays.
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

## Secret bundle (operator side, once)

Two namespace-scoped Secrets must exist before applying the manifests:

- `sentropic-postgres` — `POSTGRES_PASSWORD`.
- `sentropic-api` — `DATABASE_URL`, every `*_API_KEY`, `MAIL_USERNAME`,
  `MAIL_PASSWORD`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`.

`make scw-bundle-secret` reads `~/src/sentropic/.env` and creates both
in-cluster, replacing the previous version. Re-run after rotating a key.

## Deploy

```bash
KUBECONFIG=~/.kube/poc.yaml make scw-bundle-secret
KUBECONFIG=~/.kube/poc.yaml make scw-deploy                  # base stack
KUBECONFIG=~/.kube/poc.yaml make scw-deploy SCW_INGRESS=1    # + Ingress
```

## Smoke test

```bash
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
KUBECONFIG=~/.kube/poc.yaml make scw-undeploy
```

This removes the workload (Deployments, Services, Secrets created here,
StatefulSet, ConfigMaps). The namespace, ResourceQuota, LimitRange and
NetworkPolicy stay (owned by poc-k8s).
