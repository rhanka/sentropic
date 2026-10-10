# IdP identity sync prod → preprod

This CD flow preserves prod `users.id` as the IdP subject in preprod. It copies only
the reviewed users/WebAuthn columns, explicit OAuth consents and allowlisted
OAuth client configuration. Existing preprod client secrets, unselected clients,
signing keys and authentication state of users whose IDs do not change stay intact.

## Flow and ownership

1. `bundle-prod` applies the prod sync subdirectory, provisions the read-only
   `idp_identity_reader` role, and proves the trigger's admission restriction.
2. `run` temporarily unsuspends `sentropic/sentropic-idp-identity-export`.
   A single repeatable-read snapshot produces CSVs, counts and SHA256SUMS; s5cmd
   uploads them to `sentropic-idp-identity-relay/idp-identity/latest/` in BHS.
3. CI waits for the new Job, reads counts from the export init container's
   termination message through pod status, then always re-suspends the CronJob.
   The prod trigger cannot create Jobs or read pod logs.
4. CI switches to the preprod kubeconfig, applies the preprod sync subdirectory
   from the same checkout, then creates a uniquely named import Job. Bundle
   application failure stops before Job creation.
   Before downloading the relay, its init containers dump the complete preprod
   database in custom format and upload `pre-idp-sync/<job-name>.dump` using the
   **preprod** `sentropic-pgbackup` Secret's bucket and identity.
5. The importer checks the file manifest, checksums, snapshot age (default 7200 s),
   counts and the authorized rekey pairs before completing one SQL transaction.
   CI reads the import logs and termination JSON, prints only the whitelisted
   counts/IDs and adds that JSON to the GitHub step summary.

Prod writes with the relay writer; preprod reads with a separate read-only relay
identity. Neither prod database credentials nor the writer enter preprod.
Both CronJobs are dormant (`*/5`, `suspend: true`, Forbid); the preprod CronJob is
a future trigger target with frozen `DRY_RUN=1`, empty `ALLOWED_REKEY` and empty `ALLOWED_CLIENTS`.
This version uses the rendered import Job instead of a preprod trigger SA.

The relay contains personal data. It is dedicated to this tenant, uses TLS and
AES256 at rest, has no versioning or object lock, and expires `idp-identity/`
objects after two days. It is a transfer location, not a rollback archive.

## Bootstrap before arming (tenant admin + k8s lane)

These actions are prerequisites for authorized operators; local development tests
never contact a cluster and do not change GitHub settings.

- The tenant admin applies [rbac-ci-idp-bundle-prod.yaml](rbac-ci-idp-bundle-prod.yaml).
  This identity can update only the two existing prod Secrets by name, apply the
  bundle resources, provision the reader Job and impersonate the narrow trigger.
  Kubernetes `create` rights cannot be name-scoped; keep this kubeconfig confined
  to the protected bundle environment. It has no admission-policy permissions.
- Pre-create Opaque prod Secrets `sentropic-idp-relay-writer` and
  `sentropic-idp-identity-reader`. CD uses `get`/`replace`, never Secret creation.
  Ensure `sentropic-postgres/POSTGRES_PASSWORD` is the live app-role password.
- The tenant admin deposits `sentropic-idp-relay-reader` in `sentropic-preprod`,
  with `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`.
  Confirm the existing preprod CI identity can apply Jobs and read their status,
  pods and logs; its PostgreSQL and pgbackup Secrets must be preprod identities.
  Confirm the backup identity accepts `pre-idp-sync/<job-name>.dump` and that an
  authorized recovery identity can read those dumps.
- The k8s lane applies [vap-ci-trigger-suspend-only.yaml](vap-ci-trigger-suspend-only.yaml)
  and its Deny binding. Tenant CD does **not** apply admission resources.
  If the impersonated jobTemplate change is admitted, denied only by RBAC, or the
  suspend flip is denied, bundle CD empties the trigger Role and fails closed.
- Mint bounded TokenRequest kubeconfigs (maximum 90 days) for bundle and trigger
  SAs. The trigger SA is created by the dormant bundle; provision its kubeconfig
  after that SA exists. Record actual expiry, keep material outside git at 0600,
  and verify the prod apiserver hostname before depositing it in GitHub.
- Configure environments `sentropic-idp-prod` and `sentropic-idp-run`: required
  owner reviewers, main-only deployment restrictions and no bypass. Both workflow
  jobs also enforce `refs/heads/main`. See [CRED_CYCLE.md](CRED_CYCLE.md).

`sentropic-idp-prod` environment secrets:
`KUBE_CONFIG_DATA_IDP_BUNDLE_PROD`, `SENTROPIC_IDP_RELAY_WRITER_S3_ACCESS_KEY`,
`SENTROPIC_IDP_RELAY_WRITER_S3_SECRET_KEY`, `SENTROPIC_IDP_IDENTITY_READER_PG_PASSWORD`.
Its variables: `EXPECTED_KUBE_APISERVER_HOST_PROD`,
`SENTROPIC_IDP_RELAY_S3_BUCKET=sentropic-idp-identity-relay`,
`SENTROPIC_IDP_RELAY_S3_ENDPOINT=https://s3.bhs.io.cloud.ovh.net`,
`SENTROPIC_IDP_RELAY_S3_REGION=bhs`.

`sentropic-idp-run` environment secrets: `KUBE_CONFIG_DATA_IDP_TRIGGER_PROD` and
`KUBE_CONFIG_DATA_PREPROD`. Its variable: `EXPECTED_KUBE_APISERVER_HOST_PROD`.
Kubeconfigs may be raw YAML or base64. Each job removes its private files in an
`always()` cleanup step. Never put expressions inside shell `run:` commands.

## Dry-run, real run and acceptance

1. Leave repository variables `IDP_SYNC_CD_ENABLED` and
   `IDP_SYNC_SCHEDULE_ENABLED` unset until bootstrap is ready. Arm bundle CD with
   `IDP_SYNC_CD_ENABLED=true`; its main push paths cover the prod subdirectory,
   this CI directory and the sync workflow. Confirm reader provisioning and the
   anti-RCE gate pass. Dispatch also runs the armed bundle before the import.
2. Dispatch `IdP identity sync` on **main** with `DRY_RUN=true` (default),
   `ALLOWED_REKEY` empty unless a reviewed collision requires explicit approval.
   Set `ALLOWED_CLIENTS=immo-mcp` for the first client qualification; empty means
   no client writes. This is a comma-separated list of prod IDs, trimmed and
   unique, using the same client-ID map as consents (otherwise identity mapping).
   A dry-run still exports, uploads the rollback dump and runs the full SQL
   transaction, then rolls it back. It must finish with `outcome=rolled_back`.
3. Inspect the counts and every `rekey_pairs` entry. For the reviewed initial
   owner collision, the explicit pair is
   `9f11d240-fc75-4d55-80be-1bafcd79eadb>1b9b9e15-2956-4df4-9ee1-a42273f0d096`.
   Any pair outside `ALLOWED_REKEY` aborts; an empty allowlist forbids rekeying.
   Comma-separated elements may have surrounding whitespace.
4. After owner approval, dispatch `DRY_RUN=false`, the same reviewed allowlist,
   and `CONFIRM=idp-sync-YYYY-MM-DD` using today's **UTC** date. Successful audit
   must show `outcome=committed`, expected counts, and exactly the approved pairs.
   Rekeying drops sessions, challenges, magic links, authorization codes, OAuth
   tokens and consents of the old ID. Product FKs, WebAuthn and revoked tokens
   repoint to the prod ID; revocations survive. Re-login is expected.
5. Confirm preprod identity access and product continuity. The synthetic fixture
   gate expects users 9 / WebAuthn 22 / collisions 0; these are test baselines,
   not a substitute for checking live snapshot counts. A repeat import is a no-op.
6. Only then arm `IDP_SYNC_SCHEDULE_ENABLED=true`. Daily schedule `40 4 * * *`
   uses real import and **always empty rekey and client allowlists**, with no manual CONFIRM.
   Any new collision therefore stops the scheduled import for manual review.

The JSON includes `synced_users`, `synced_webauthn`, `rekeyed`,
`preprod_only_kept`, `post_users`, `post_webauthn`, `rekey_dropped_sessions`,
`rekey_moved_webauthn`, `consents_upserted`, `consents_removed`, `clients_upserted`,
`clients_removed`, `clients_skipped_confidential`, `rekey_pairs`,
and `outcome`. Job completion alone is not
acceptance: the expected termination audit must also be available and valid.

## Consent convergence and client mapping

For each prod user, preprod has exactly the prod grants on mapped clients: a
missing grant still shows the consent screen, including for a newly imported
user. No trusted-client flag or consent bypass is introduced.

The versioned [client-map.csv](../../k8s/overlays/preprod/idp-identity-sync/client-map.csv)
maps `radar-immobilier` to `radar-immobilier-preprod`. It ships only in the preprod
SQL ConfigMap. Source and target client IDs are both unique in the map, and every
target must exist after the allowlisted client pass; an invalid map aborts the entire transaction.

The same repeatable-read export includes `users.csv`, `webauthn.csv`,
`consents.csv`, `clients.csv` and `snapshot.csv`, all covered by SHA256SUMS.
Snapshot fields are UTC timestamp, user count, WebAuthn count, consent count and
client count. The reader has six consent-column and fourteen client-column grants,
plus client_id/has_secret on the prod-owned `idp_oauth_client_secret_presence`
security-barrier view, provisioned by the same protected reader Job. Raw client
hash and row-ID reads are denied, including removal of an older column hash grant.
Client export contains `has_secret`, never the secret hash or prod row ID; its
import requires the exact CSV header with PostgreSQL `HEADER MATCH`.

The importer maps consent client IDs and copies tenant IDs, scopes and timestamps
exactly. It updates changed grants and deletes grants absent from prod for
imported users on mapped clients, including revocations. Preprod-only users'
grants and grants on unmapped clients stay intact. Rekeying drops the duplicate's
grants; consent sync recreates explicit prod grants under the prod user ID.
Audit counts `consents_upserted` and `consents_removed` report actual changes;
an unchanged rerun reports 0/0. Failed maps and postconditions emit only
`consent_client_missing` or `consent_postcondition_failed`.

The sync run delivers its own importer before Job creation; it does not depend
on the general `deploy-preprod` app rollout succeeding. This keeps the five-file
export manifest and importer aligned even after a skipped app deployment.
The preprod CI identity must be allowed to apply the scoped sync resources,
including its SQL ConfigMap. Manifest validation remains strict.
After merge, s-conductor dispatches a dry-run and then an approved real run.

## OAuth client convergence

The client pass runs after identities and before consents in the same transaction.
Only `ALLOWED_CLIENTS` may change. An absent requested source aborts with
`client_source_missing`; preprod-only clients are preserved. There is no managed
deletion allowlist in this version, so `clients_removed` is always zero.

[host-map.csv](../../k8s/overlays/preprod/idp-identity-sync/host-map.csv) is the sole
rewrite policy for this pass: `immo.sent-tech.ca`, `sentropic.sent-tech.ca` and
`auth.sent-tech.ca` map to their `preprod.` hosts. The existing ingress/config
overlays already declare the sentropic/auth pairs; bundle tests verify agreement.
Exact HTTPS authorities in redirects and resource indicators are rewritten;
ports, paths and queries survive. External callbacks (including
`https://claude.ai/api/mcp/auth_callback`) remain byte-identical. Already mapped
preprod hosts remain unchanged. Unmapped sent-tech.ca hosts, userinfo, fragments,
backslashes, invalid percent escapes, empty/invalid DNS labels, DNS terminal dots,
noncanonical/invalid IPv4, insecure URIs and ambiguous maps fail with `client_policy_invalid`.

Public clients require `none`, no secret and PKCE. Inserts get a fresh preprod
row ID and a null hash. Existing confidential clients require a matching
basic/post method and an independent non-null preprod hash, preserved exactly.
New confidential clients are skipped and counted as `clients_skipped_confidential`;
this sync does not provision their independent secret. The registration contract
is `api/src/scripts/oauth-register-client.ts`; automated preprod confidential
secret provisioning is not implemented by this flow and requires a separate
governed CD integration. Changing a client's classification fails closed.
This pass accepts the registered authorization_code/code shape; unsupported
grant/response configurations fail for review rather than broadening access.

Configuration, scopes, tenant and timestamps converge on changed rows only.
Null tenants become `sentropic`; unknown tenants fail closed. Owners bind to
existing synced preprod users, or null if absent. Existing IDs/hashes, whole
unselected client rows and signing keys are verified unchanged. Desired client
configuration is checked exactly; tampering emits `client_postcondition_failed`
or `dv5_invariant_changed`, rolling back identities, clients and consents together.

The synthetic `immo-mcp` acceptance uses public PKCE, the external Claude callback,
scopes `immo:read`, `immo:search`, `immo:documents:read`, and rewritten resource
`https://preprod.immo.sent-tech.ca/mcp`. The SQL gate passes its committed row
to the real authorize handler and proves 302 to preprod login, missing-client
400 and rejection of the prod resource. Live acceptance follows owner-approved CD;
local tests and PR CI never run the real sync.
The immo host pair is owner-declared in the build brief; immo lives in a separate
tenant/repository. Its DNS, ingress and configured MCP audience require validation
by that tenant during the owner-gated CD acceptance.

## Failure and rollback

On import SQL/integrity/freshness failure, no transaction commits. Inspect the
validated failure code and UUID-only rekey pairs; never publish raw diagnostic files or CSVs.
Export failure re-suspends prod; the workflow skips the dependent import.

To reverse a **committed** import, first disable scheduled runs and stop preprod
writes through the existing tenant maintenance process. Record the import Job
name and recover `s3://<preprod-pgbackup-bucket>/pre-idp-sync/<job-name>.dump`
with an authorized preprod recovery identity. Verify a scratch restore using
the existing database restore procedure before restoring the preprod database.
The dump is a full database rollback and discards writes since capture; it is
not a selective IdP undo. This workflow does not automate restoration. Keep
prod credentials out of recovery, then validate identities/product rows and
re-enable writes only after operator acceptance. Confirm actual backup retention
before every real run; relay two-day retention does not cover these dumps.

## Local gates

```sh
make test-idp-sync-selftest ENV=test-idp-sync
make test-idp-sync-sql ENV=test-idp-sync
```

Pinned containers perform kustomize rendering, mocked CI controls and isolated
Postgres tests. The SQL gate runs the CronJob's actual `export-prod.sh`, including
five-file SHA256SUMS generation, then the import Job's actual shell validator and
SQL through a committed `immo-mcp` upsert and an unchanged rerun. Missing or
duplicate client manifest entries, unexpected files and checksum tampering fail
closed. Selftests also check Node and shell syntax. No Python or cluster access is used.
