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
  tenant default-deny baseline: api -> postgres, ui -> api.
- `20-postgres.yaml` — Postgres 17 StatefulSet + headless Service + 1Gi PVC on
  `scw-bssd` + ConfigMap (`POSTGRES_DB`, `POSTGRES_USER`).
- `30-api.yaml` — `sentropic-api` SCW Container Registry image + ClusterIP
  Service (port 8787) + non-secret ConfigMap. The ConfigMap sets
  `NODE_OPTIONS=--dns-result-order=ipv4first` so Node prefers IPv4 where its
  DNS path honors the option on this IPv4-only POC egress path.
- `40-ui.yaml` — `sentropic-ui` SCW Container Registry image + ClusterIP
  Service (port 5173) + placeholder ConfigMap for future overlays.
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
- `sentropic-api` — `DATABASE_URL`, every `*_API_KEY`, `MAIL_HOST`,
  `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`,
  `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`.

Maildev is intentionally not deployed in Kubernetes. The POC uses the checked
`sent-tech.ca` domain in Scaleway Transactional Email, with SMTP settings read
from `SCW_ENV_FILE` by `make scw-bundle-secret`. Active `MAIL_*` entries win.
For the historical POC `.env` format, the target can also recover commented
`#export MAIL_USERNAME=...` and `#export MAIL_PASSWORD=...` entries and derive
`MAIL_HOST=smtp.tem.scaleway.com`, `MAIL_PORT=465`, and `MAIL_SECURE=true`. If
no host or POC credentials are present, the target injects an empty `MAIL_HOST`
so the API does not fall back to its local `maildev` default. When `MAIL_HOST`
is set, `MAIL_USERNAME` and `MAIL_PASSWORD` must also be set or recoverable;
`MAIL_FROM` defaults to `no-reply@sent-tech.ca`.

The api and ui manifests target the `main` alias tag on
`rg.fr-par.scw.cloud/nc-reg/sentropic-api` and
`rg.fr-par.scw.cloud/nc-reg/sentropic-ui`. The `publish-{api,ui}-image`
jobs in `.github/workflows/ci.yml` push two tags per image: a
content-hash sha1 (immutable, used by `make publish-{api,ui}-image`) and the
floating `main` alias. `imagePullPolicy: Always` plus the `deploy-k8s` CI job running
`make scw-deploy` guarantee Kubernetes picks up manifest changes and the latest
digest without any imperative `kubectl set image`.
`make scw-bundle-secret`
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
make scw-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make scw-email-smoke KUBECONFIG=$HOME/.kube/poc.yaml SCW_EMAIL_SMOKE_TO=<recipient> ENV=test-feat-deploy-poc-k8s

make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=api PORT=8787 &
curl http://localhost:8787/api/v1/health
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=ui PORT=5173 &
xdg-open http://localhost:5173
```

`scw-api-netcheck` defaults to `smtp.tem.scaleway.com:465`; override
`SCW_NETCHECK_HOST`, `SCW_NETCHECK_PORT`, and `SCW_NETCHECK_TIMEOUT` to test
another endpoint. Current live POC evidence: `api.scaleway.com:443` is
reachable from `deploy/api`, while `smtp.tem.scaleway.com:465`,
`smtp.tem.scaleway.com:587`, and direct IPv4 `51.159.84.239:465` time out.
As a result, `scw-email-smoke` reaches the api but cannot deliver mail until
SMTP egress is opened/routed for the cluster or the app moves to a non-SMTP
TEM relay/API.

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
StatefulSet, ConfigMaps, and any legacy Maildev resources). The namespace,
ResourceQuota, LimitRange and
NetworkPolicy stay (owned by poc-k8s).

## Sealed Secrets

[Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) makes
cluster Secrets git-as-source-of-truth: the operator encrypts a plaintext
`Secret` into a `SealedSecret` resource that is safe to commit, and the
in-cluster controller decrypts it back into a real `Secret` only inside the
target cluster. The controller manifest is
`deploy/scw/01-sealed-secrets-controller.yaml`, pinned to upstream **v0.37.0**
and retargeted to the dedicated `sealed-secrets` namespace (controller name
`sealed-secrets-controller`).

### Install the controller (once per cluster)

```bash
make scw-sealed-secrets-install KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
```

This applies the pinned manifest and waits for the controller rollout.

### Seal a secret (operator workflow)

`kubeseal` runs inside the pinned `docker.io/bitnami/sealed-secrets-kubeseal:0.37.0`
image (no host install needed) and fetches the controller's public certificate
from the live kube API via the mounted `KUBECONFIG`. The `make scw-seal-secret`
target only transforms a plaintext Secret yaml into a SealedSecret yaml — it
never reads or hardcodes a secret value.

1. Build a plaintext `Secret` manifest from the values in root `.env` (do **not**
   commit this plaintext file; keep it out of the repo, e.g. under `/tmp`):

   ```bash
   kubectl -n sentropic create secret generic sentropic-api \
     --from-literal=SCW_TEM_SECRET_KEY="<value from .env>" \
     ... \
     --dry-run=client -o yaml > /tmp/plain-sentropic-api.yaml
   ```

2. Seal it into a committable SealedSecret:

   ```bash
   make scw-seal-secret \
     SEAL_SRC=/tmp/plain-sentropic-api.yaml \
     SEAL_OUT=deploy/scw/05-sealed-sentropic-api.yaml \
     KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
   ```

3. Delete the plaintext file (`shred -u /tmp/plain-sentropic-api.yaml`) and commit
   only the resulting `deploy/scw/05-*` / `deploy/scw/06-*` SealedSecret yaml.

The `05-*` (`sentropic-api`) and `06-*` (`sentropic-postgres` / pgbackup)
SealedSecret resource files are produced by the operator from the real secret
values after the controller is installed; they are intentionally **not**
authored as part of this manifest/tooling change.

### Disaster recovery — back up the controller sealing key

The controller stores its master sealing key as a labelled Secret in the
`sealed-secrets` namespace. If the cluster (or that key) is lost, every committed
SealedSecret becomes undecryptable. Back the key up out-of-band:

```bash
make scw-sealed-secrets-backup-key \
  SEAL_KEY_OUT=/secure/offline/sealed-secrets-key-backup.yaml \
  KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
```

**The backup file contains the master private key.** Store it offline or in a
secret manager, restrict its permissions, and **never commit it**. To restore on
a rebuilt cluster, `kubectl apply -f` the backup before installing the
controller, then re-run `make scw-sealed-secrets-install`; the controller adopts
the restored key and can decrypt the existing committed SealedSecrets.
