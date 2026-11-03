# Email-code HMAC key — credential cycle and runbook (Q-K=A)

Tenant-side runbook for the email-code HMAC key ring, binding method
`qk-secret-custody-r2` (sha256 1dcfb24d…, owner decision Q-K=A 2026-11-02,
validated through k8s; platform conditions C1–C5 applied). This file carries
names, refs, fingerprints, test vectors and dates only — never a value.
Modeled on `deploy/ci/idp-identity-sync/CRED_CYCLE.md`.

## 1. Scope and names

### 1.1 keyRef scheme

Every generated key has one immutable reference
`email-code-hmac:v1:<tier>:<fp16>`, where `<tier>` is `prod` | `preprod` |
`test` and `fp16` is the first 16 hex chars of the keyed fingerprint
(`HMAC-SHA256(keyBytes, "sentropic/email-code-hmac/fingerprint/v1")`,
lowercase hex). A keyRef names exactly one byte string forever; remapping a
ref in place is forbidden. The ring holds at most two keys: one ACTIVE
(issuing) and at most one PREVIOUS (non-issuing).

### 1.2 Names at every layer

| Layer | Active value | Previous value | Active ref | Previous ref |
| --- | --- | --- | --- | --- |
| Central `.env` (git-ignored, mode 0600) | `PROD_EMAIL_CODE_HMAC_KEY_ACTIVE` / `PREPROD_…` | `PROD_EMAIL_CODE_HMAC_KEY_PREVIOUS` / `PREPROD_…` | `…_ACTIVE_REF` | `…_PREVIOUS_REF` |
| GitHub environment secret (`sentropic-idp-prod` = prod, `sentropic-idp-run` = preprod) | `EMAIL_CODE_HMAC_KEY_ACTIVE` | `EMAIL_CODE_HMAC_KEY_PREVIOUS` | — | — |
| GitHub environment variable (metadata) | — | — | `EMAIL_CODE_HMAC_KEY_ACTIVE_REF` | `EMAIL_CODE_HMAC_KEY_PREVIOUS_REF` |
| k8s Secret `email-code-hmac` (Opaque), namespace `sentropic` / `sentropic-preprod` | key `EMAIL_CODE_HMAC_KEY_ACTIVE` | key `EMAIL_CODE_HMAC_KEY_PREVIOUS` | key `EMAIL_CODE_HMAC_KEY_ACTIVE_REF` | key `EMAIL_CODE_HMAC_KEY_PREVIOUS_REF` |
| Pod env (Deployment `api`) | same four names | | | |

The previous pair is present together or absent together at every layer;
present-but-empty is invalid. Preprod and prod values are distinct keys; the
generation tool refuses a fingerprint equal to any current tier key.

### 1.3 Writer identity and kubeconfig (platform credential, not HMAC material)

Provisioning writes through the dedicated writer service account
`sentropic-ci-email-code-hmac` per tier (Role: `secrets` `resourceNames:
[email-code-hmac]` `get`/`patch`/`update`; `deployments` `resourceNames:
[api]` `get`/`patch`/`watch`; no `create`/`delete`/`list` on Secrets). The
empty Secret shell `email-code-hmac` is pre-created by k8s in each tier
namespace, and the ValidatingAdmissionPolicy `email-code-hmac-single-writer`
denies `CREATE`/`UPDATE`/`DELETE` on it except for the tier writer and
`sentropic-admin` (break-glass).

| Layer | Preprod | Prod |
| --- | --- | --- |
| `.env` variable (k8s-minted kubeconfig) | `K8S_EMAIL_CODE_HMAC_WRITER_PREPROD_KUBECONFIG_B64` | `K8S_EMAIL_CODE_HMAC_WRITER_PROD_KUBECONFIG_B64` |
| Token expiry marker | `K8S_EMAIL_CODE_HMAC_WRITER_PREPROD_TOKEN_EXPIRES` | `K8S_EMAIL_CODE_HMAC_WRITER_PROD_TOKEN_EXPIRES` |
| GitHub environment secret | `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` in `sentropic-idp-run` | `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` in `sentropic-idp-prod` |

Mint/renewal dates are recorded by k8s in the governance entry
`preprod-cred-governance.md#email-code-hmac-writer` (poc-k8s repo) — see §7.2.
**Renew the writer kubeconfig before 2027-02-01T00:12:16Z** (current token
expiry): k8s re-mints into the same `.env` names, the tenant re-deposits as
`KUBE_CONFIG_DATA_EMAIL_CODE_HMAC`, K7 `can-i` lines are re-proved, then the
workflow runs nominally. Kubeconfig loss alone implies no HMAC rotation.

k8s noted the following cluster-level and residual identities when validating
the method (recorded as facts, not narrowed by this runbook): the
`kubernetes-admin` identity and the `kube-system` controllers hold
cluster-wide rights on the API server; `ci-deployer` (both tiers), the
`sentropic-preprod` service account bound to `edit` (preprod) and
`sentropic-admin` (both namespaces) can still `get` this Secret — admission
cannot block a `GET` (C3). The app service account `sentropic-app` cannot
`get` Secrets in either namespace (env injection only, K7).

## 2. Generation and deposit (tenant, reviewed make targets only)

All custody operations run through `node deploy/ci/email-code-hmac/custody.mjs`
via the reviewed targets; `ENV` is always the last argument and selects the
tier (`preprod`/`prod` → central `.env`; `test-*`/`e2e-*` → `.env.$(ENV)`,
tier segment `test`):

| Target | Effect |
| --- | --- |
| `make email-code-hmac-generate ENV=<tier>` | Bootstrap only: creates the ACTIVE pair; refuses if ACTIVE exists. Deposits the GitHub environment secret/variable via `gh secret set` / `gh variable set` reading stdin. `EMAIL_CODE_HMAC_DRY_RUN=1` computes and prints refs/fingerprint/test vector without writing. |
| `make email-code-hmac-rotate-begin ENV=<tier>` | P1: generates the next key into PREVIOUS; refuses if PREVIOUS occupied or ACTIVE missing. |
| `make email-code-hmac-rotate-promote ENV=<tier>` | P2: swaps ACTIVE/PREVIOUS atomically. |
| `make email-code-hmac-rotate-retire ENV=<tier> PROOF=<file>` | P3: removes PREVIOUS; refuses without the §4 proof attestation. |
| `make email-code-hmac-fingerprint ENV=<tier>` | Prints refs and full keyed fingerprints only. |
| `make email-code-hmac-verify-vector ENV=<tier> EXPECTS="ref=vector …"` | Recomputes test vectors from `.env` and prints match/mismatch per ref. |
| `make test-email-code-hmac-selftest ENV=test-email-code-hmac` | Offline K2/K3 selftests (dry-run, no-print, workflow materialize logic). Gate job of the workflow. |

Generation properties: CSPRNG `randomBytes(32)` hex-encoded to 64 lowercase
hex; the value exists only in process memory and the private-descriptor write
(`O_WRONLY|O_CREAT|O_EXCL`, mode 0600, `umask 077`, fsync, atomic rename, dir
fsync — unrelated lines and mode 0600 preserved byte-for-byte); preconditions
(env file exists, is git-ignored via mechanical `git check-ignore`, mode 0600,
slot state, cross-tier fingerprint difference) are checked before any write;
the mutable key buffer is zeroed in `finally`. Output is limited to tier,
slot, keyRef, fingerprint, test vector and the deposit/registry instruction.

## 3. Provisioning to preprod and prod

Path per tier: central `.env` → GitHub environment (secret + ref variable) →
`workflow_dispatch` on main of `.github/workflows/email-code-hmac-secret.yml`
(authenticated as the tier writer via `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC`) →
server-side apply (`--field-manager=email-code-hmac-secret`) onto the
pre-created empty shell → `rollout restart`/`rollout status` on Deployment
`api`. The workflow never creates or lists Secrets, never prints values, and
its job summary shows names, refs and keyed fingerprints only. Bootstrap
ordering: the first workflow run fills the shell **before** the `api`
Deployment references the Secret; preprod is provisioned and verified first,
then prod. The workflow is not run by this branch — the conductor triggers it
after review.

## 4. Rotation cycle (90 days per tier)

Preprod rotates and verifies first, prod second; a new rotation must not begin
while PREVIOUS is occupied (retire first). Phases: **P1** `rotate-begin` +
deposit PREVIOUS + workflow run (active = old, previous = [next]); **P2**
`rotate-promote` + deposit swap + workflow run (active = next, previous =
[old]); **P3** after the proof below, `rotate-retire` + delete the PREVIOUS
GitHub pair + workflow run (active = next, no previous). Overlap P2→P3: hard
floor 1 h, nominal hold 24 h after the P2 rollout. Emergency rotation
(suspected compromise): P1+P2 back-to-back, retire at the 1 h floor once the
count is zero; optionally revoke pending codes under the compromised ref.

Retirement proof (mandatory before P3), run by the tenant against the tier
database, count only:

```sql
SELECT count(*) FROM identity_single_use_proofs
WHERE kind = 'email_code' AND state = 'pending'
  AND expires_at > now()
  AND digest_algorithm = 'hmac-sha256'
  AND digest_key_ref = '<old keyRef>';
```

Required result `0`; the attestation file `{ "keyRef": "<old ref>",
"pendingCount": 0, "checkedAt": "<ISO-8601>" }` is the `PROOF=` input of
`rotate-retire`. Record count, ref and timestamp in the registry (§7.1).

## 5. Backup, restore and loss

### 5.1 Where the recovery copy lives

Three operator-controlled copies of each live key: (1) central `.env` (source
of truth, git-ignored 0600), (2) the GitHub environment secret per tier, (3)
k8s Secret `email-code-hmac` per tier namespace (written only by the
workflow). Plus, outside operator control: etcd persistence and backups
managed by OVH (encryption at rest unverified from inside the cluster —
source-gap). The key is never in `pg_dump`, any database, S3 buckets,
SealedSecrets or git history. Retirement proves removal from the three
operator-controlled copies only.

### 5.2 Verifying a restore without exposing the value

1. `make email-code-hmac-fingerprint ENV=<tier>` → refs + fingerprints from `.env`.
2. `make email-code-hmac-verify-vector ENV=<tier> EXPECTS="ref=vector …"` → the `.env` value reproduces the registry test vector.
3. Re-run the workflow for the tier → its JSON log line fingerprints must equal step 1.
4. Pod startup log line (refs + fingerprints) must equal step 1 on every replica after rollout.
5. Preprod only, after step 4: synthetic canary — request and verify a code for the tenant test mailbox.

Registry receipt: tier, refs, fingerprints, test-vector match, workflow run
id, canary result, date. Never a value.

### 5.3 Loss matrix and break-glass

| Loss | Nominal recovery |
| --- | --- |
| k8s Secret data corrupt (object present) | Re-run the workflow; pods fail closed meanwhile. |
| k8s Secret object deleted (shell gone) | Workflow refuses `email_code_hmac_shell_missing` and attempts no `create`; k8s re-pre-creates the empty shell, then re-run the workflow. |
| Writer kubeconfig lost/expired/forbidden | k8s re-mints into the same `.env` names; tenant re-deposits as `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC`; re-prove K7; run the workflow. Renew before 2027-02-01T00:12:16Z. |
| GitHub environment secret wrong | Re-deposit from `.env`; the workflow's `fp16` check refuses before apply. |
| Central `.env` lost | Do not extract from the cluster nominally: rotate (P1/P2), retire the lost key after the §4 proof. |
| All operator-controlled copies of the active key lost | Fresh bootstrap ring; pending codes under the lost ref cannot verify (bounded by the 600 s code TTL); record the incident. |

Break-glass (the only manual-kubectl path): if the workflow is unavailable,
`sentropic-admin` may apply the Secret once manually from the `.env` values
via a 0600 temp file with the same field manager `email-code-hmac-secret` —
never `--from-literal`. There is no Kubernetes API audit log on this cluster,
so the same-day registry record is the only trace (C5); the episode closes
only when the next workflow run succeeded and `metadata.managedFields`
(manager names only) shows the data fields reconverged under
`email-code-hmac-secret`. k8s noted that the `kubernetes-admin` identity and
the `kube-system` controllers hold cluster-wide API rights (see §1.3); the
break-glass path above is the tenant-admin (`sentropic-admin`) exception
pinned by the admission policy.

## 6. Failure posture (fail closed, no fallback)

Missing/invalid ring at pod start (`optional: false` on the ACTIVE pair), in
the workflow (fixed codes `email_code_hmac_credential_invalid` /
`email_code_hmac_ref_mismatch` / `email_code_hmac_shell_missing` /
`email_code_hmac_writer_forbidden`, Secret untouched), or at issuance
(`identity_material_missing` before any row or email) — no empty, default,
derived or SHA-only issuance fallback.

## 7. Registry and governance

### 7.1 Living registry (this file is the tenant registry)

One row per (tier, keyRef): fingerprint, test vector, generated date, P1/P2
dates with workflow run ids, retirement proof (zero count + timestamp),
retired date, next due date (generated + 90 days). Plus one record per
break-glass episode (same-day act record; closure = re-converging workflow
run id + `managedFields` manager names observed). Updated at every phase.
Current state: **not yet generated** — the conductor triggers
`make email-code-hmac-generate ENV=preprod` / `ENV=prod` after review of this
branch; no row exists before that.

### 7.2 k8s governance entry and kubeconfig renewal

The k8s-side governance record for this credential lives in the poc-k8s repo:
`preprod-cred-governance.md#email-code-hmac-writer` — writer SAs and exact
Role scope, empty-shell pre-creation, admission policy scope, residual reader
names, writer kubeconfig `.env`/GitHub names with mint/expiry/next-renewal
dates, and the K7 `can-i` + admission matrix results. **Renewal deadline:
before 2027-02-01T00:12:16Z** (current writer token expiry), via the same
mint → `.env` → `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` deposit path under the
names in §1.3.

### 7.3 Acceptance checklist (value-free)

| ID | Check | Status |
| --- | --- | --- |
| K1 | Names-only audit: no Secret manifest with data values, no SealedSecret for `email-code-hmac`; only the empty shell shape is allowed | selftest (`no literal 64-hex…`) + reviewed diff |
| K2 | Generation on a scratch env file: 64-hex, right slot, mode 0600 + unrelated lines preserved, overwrite/tracked/wrong-mode refusals, value absent from captured output | `make test-email-code-hmac-selftest ENV=test-email-code-hmac` |
| K3 | Workflow materialize logic: invalid shapes refused pre-apply, manifest keys exactly §1.2, keyed fingerprint logged (never a bare hash), failing step never echoes a value | same selftest target; gate job of the workflow |
| K4–K8 | Preprod functional drill, three-location fingerprint equality, restore drills, RBAC/admission matrix, missing-key drill | run by the conductor after this branch merges, per method §7.3; receipts recorded in §7.1 |
