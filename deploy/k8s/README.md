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
  tenant default-deny baseline: api -> postgres, ui -> api, pgbackup -> postgres,
  and the cluster Traefik namespace -> ui (public ingress).
- `07-sealed-sentropic-pgbackup.yaml` — SealedSecret `sentropic-pgbackup`
  (`S3_ACCESS_KEY`/`S3_SECRET_KEY` reused from DOC_STORAGE, `S3_BUCKET`,
  `S3_REGION`, `S3_ENDPOINT`) for the Postgres backup CronJob.
- `70-pgbackup-cronjob.yaml` — nightly `pg_dump` CronJob uploading a gzip to
  `s3://$S3_BUCKET/pg/<ts>.sql.gz` (see "Postgres backup" below).
- `20-postgres.yaml` — Postgres 17 StatefulSet + headless Service + 1Gi PVC on
  `k8s-bssd` + ConfigMap (`POSTGRES_DB`, `POSTGRES_USER`).
- `30-api.yaml` — `sentropic-api` SCW Container Registry image + ClusterIP
  Service (port 8787) + non-secret ConfigMap. The ConfigMap sets
  `NODE_OPTIONS=--dns-result-order=ipv4first` so Node prefers IPv4 where its
  DNS path honors the option on this IPv4-only POC egress path.
- `40-ui.yaml` — `sentropic-ui` SCW Container Registry image + ClusterIP
  Service (port 5173) + placeholder ConfigMap for future overlays.
- `60-ingress.yaml` — public Traefik Ingress for `sentropic.sent-tech.ca`
  (single host → `ui`; nginx proxies `/api`→api:8787) with cert-manager TLS via
  the platform `letsencrypt-prod` ClusterIssuer. Apply with `K8S_INGRESS=1`.

## Prerequisites (cluster operator side, in `~/src/poc-k8s/`)

```bash
make kubeconfig                 # ~/.kube/poc.yaml
make apply-platform             # cert-manager + traefik labels
make apply-sentropic            # namespace + RQ + LimitRange + NetPol
```

The namespace pull secret is managed from this repo with:

```bash
make k8s-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml K8S_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
```

The target creates the `sentropic-registry` `dockerconfigjson` Secret in the
`sentropic` namespace. It reads `REGISTRY`, `DOCKER_USERNAME`, and either
`SCW_REGISTRY_TOKEN` or `DOCKER_PASSWORD` from `K8S_ENV_FILE`; it does not
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
from `K8S_ENV_FILE` by `make k8s-bundle-secret`. Active `MAIL_*` entries win.
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
`make k8s-deploy` guarantee Kubernetes picks up manifest changes and the latest
digest without any imperative `kubectl set image`.
`make k8s-bundle-secret`
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
make k8s-bundle-secret KUBECONFIG=$HOME/.kube/poc.yaml K8S_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
make k8s-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml K8S_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s
make k8s-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make k8s-deploy KUBECONFIG=$HOME/.kube/poc.yaml K8S_INGRESS=1 ENV=test-feat-deploy-poc-k8s
```

## Smoke test

```bash
make k8s-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make k8s-api-netcheck KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
make k8s-email-smoke KUBECONFIG=$HOME/.kube/poc.yaml K8S_EMAIL_SMOKE_TO=<recipient> ENV=test-feat-deploy-poc-k8s

make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=api PORT=8787 &
curl http://localhost:8787/api/v1/health
make -C ~/src/poc-k8s tenant-port-forward TENANT=sentropic SVC=ui PORT=5173 &
xdg-open http://localhost:5173
```

`k8s-api-netcheck` defaults to `smtp.tem.scaleway.com:465`; override
`SCW_NETCHECK_HOST`, `SCW_NETCHECK_PORT`, and `SCW_NETCHECK_TIMEOUT` to test
another endpoint. Current live POC evidence: `api.scaleway.com:443` is
reachable from `deploy/api`, while `smtp.tem.scaleway.com:465`,
`smtp.tem.scaleway.com:587`, and direct IPv4 `51.159.84.239:465` time out.
As a result, `k8s-email-smoke` reaches the api but cannot deliver mail until
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
make k8s-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s
```

This removes the workload (Deployments, Services, Secrets created here,
StatefulSet, ConfigMaps, and any legacy Maildev resources). The namespace,
ResourceQuota, LimitRange and
NetworkPolicy stay (owned by poc-k8s).

## Postgres backup (operator side)

Nightly `pg_dump` to SCW Object Storage via the `70-pgbackup-cronjob.yaml`
CronJob (`15 2 * * *`). S3 creds + bucket come from the `sentropic-pgbackup`
SealedSecret (`07-*`); the dump is written to a file, `test -s`-checked (no
empty-dump masking), gzipped, then uploaded to `s3://$S3_BUCKET/pg/<ts>.sql.gz`.
The `allow-pgbackup-to-postgres` NetworkPolicy lets the job reach postgres.

```bash
# Trigger an immediate backup Job and wait for completion:
make k8s-pgbackup-now KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37c
# Restore a chosen dump into a scratch DB (non-destructive to the app DB):
make k8s-pgbackup-restore PG_BACKUP_KEY=pg/<ts>.sql.gz \
  KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37c
```

`k8s-pgbackup-restore` runs a throwaway pod that reads `S3_BUCKET`/`S3_ENDPOINT`/
`S3_REGION` + creds from the SealedSecret (no host env dependency), downloads the
dump, restores it into a scratch `restore_check` DB, runs a sanity `SELECT`, then
drops the scratch DB.

## Public ingress / TLS

The cluster-wide ingress (Traefik + a shared SCW LoadBalancer + cert-manager +
the `letsencrypt-staging`/`letsencrypt-prod` Cloudflare DNS-01 ClusterIssuers)
is delivered by the **poc-k8s** repo (`platform/`, `make apply-platform`), not
here. This tenant only ships `60-ingress.yaml`. To (re)apply it:

```bash
make k8s-deploy K8S_INGRESS=1 KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37c
make k8s-dns-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37c
```

cert-manager issues `sentropic-tls` via a DNS-01 challenge (no public HTTP-01
needed). A Cloudflare `A` record `sentropic.sent-tech.ca` → the Traefik LB IP
must exist. `k8s-dns-smoke` asserts HTTPS 200 + a browser-trusted cert on `/`
and `/api/v1/health`.

## Sealed Secrets

[Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) makes
cluster Secrets git-as-source-of-truth: the operator encrypts a plaintext
`Secret` into a `SealedSecret` resource that is safe to commit, and the
in-cluster controller decrypts it back into a real `Secret` only inside the
target cluster. The controller manifest is
`deploy/k8s/01-sealed-secrets-controller.yaml`, pinned to upstream **v0.37.0**
and retargeted to the dedicated `sealed-secrets` namespace (controller name
`sealed-secrets-controller`).

### Install the controller (once per cluster)

```bash
make k8s-sealed-secrets-install KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
```

This applies the pinned manifest and waits for the controller rollout.

### Seal a secret (operator workflow)

`kubeseal` runs inside the pinned `docker.io/bitnami/sealed-secrets-kubeseal:0.37.0`
image (no host install needed) and fetches the controller's public certificate
from the live kube API via the mounted `KUBECONFIG`. The `make k8s-seal-secret`
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
   make k8s-seal-secret \
     SEAL_SRC=/tmp/plain-sentropic-api.yaml \
     SEAL_OUT=deploy/k8s/05-sealed-sentropic-api.yaml \
     KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
   ```

3. Delete the plaintext file (`shred -u /tmp/plain-sentropic-api.yaml`) and commit
   only the resulting `deploy/k8s/05-*` / `deploy/k8s/06-*` SealedSecret yaml.

The `05-*` (`sentropic-api`) and `06-*` (`sentropic-postgres` / pgbackup)
SealedSecret resource files are produced by the operator from the real secret
values after the controller is installed; they are intentionally **not**
authored as part of this manifest/tooling change.

### Disaster recovery — back up the controller sealing key

The controller stores its master sealing key as a labelled Secret in the
`sealed-secrets` namespace. If the cluster (or that key) is lost, every committed
SealedSecret becomes undecryptable. Back the key up out-of-band:

```bash
make k8s-sealed-secrets-backup-key \
  SEAL_KEY_OUT=/secure/offline/sealed-secrets-key-backup.yaml \
  KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b
```

**The backup file contains the master private key.** Store it offline or in a
secret manager, restrict its permissions, and **never commit it**. To restore on
a rebuilt cluster, `kubectl apply -f` the backup before installing the
controller, then re-run `make k8s-sealed-secrets-install`; the controller adopts
the restored key and can decrypt the existing committed SealedSecrets.
