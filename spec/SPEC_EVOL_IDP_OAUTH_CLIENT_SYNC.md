# OAuth client convergence for the IdP relay

Status: implemented design.

## Baseline evidence and model (origin/main 30a2362c0)

- `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:6` exports one
  repeatable-read snapshot; `reader-role.sql:26` uses column-level read grants.
- `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql:180` is the
  consent model: local client map, changed-row upsert, exact postcondition,
  counts, and transaction rollback. Clients run immediately before consents.
- `api/src/db/schema.ts:303` defines the client schema and owner/tenant FKs.
- `packages/auth-hono/src/oauth/authorize-handler.ts:307` rejects an unknown
  client before validating redirect, S256, scopes and resource; line 95 sends
  an anonymous valid request to login with 302.
- `api/src/scripts/oauth-register-client.ts:107` distinguishes public `none`
  from confidential `client_secret_basic` and requires PKCE.
- Host pairs already occur in the prod/preprod ingress and config overlays,
  including `deploy/k8s/overlays/preprod/ingress.yaml:27,55` and
  `patch-auth-idp-config.yaml:38`. There is no shared host-map table today.

## Decisions

D1. Export `clients.csv` with client_id, has_secret (boolean only), name,
redirect_uris, allowed_scopes, grant_types, response_types,
token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce,
resource_indicators, tenant_id, owner_user_id, created_at, updated_at.
Never export a client secret hash or reuse prod row IDs. Grant SELECT only on
these source columns (hash is read solely to compute has_secret). Add the client
count as the fifth snapshot field and checksum the fifth relay file.

D2. `ALLOWED_CLIENTS` is a comma-separated list of prod client IDs, empty by
default. Trim entries, reject malformed/duplicate IDs. Dispatch supplies it;
schedule forces it empty, matching ALLOWED_REKEY. An absent requested source
client aborts with `client_source_missing`. Resolve IDs through the existing
`client-map.csv`, otherwise retain the ID. Never delete clients in this version:
there is no managed deletion allowlist; `clients_removed` always equals zero.

D3. Add `host-map.csv` to the preprod ConfigMap, the sole rewrite policy for
this pass: immo, sentropic and auth under sent-tech.ca map to their `preprod.`
hosts. Parse absolute HTTPS URI authority, rewrite only the exact host, and
preserve path, port and query. External URIs stay byte-identical. Already mapped
preprod hosts stay unchanged. Reject malformed URIs, ambiguous maps, userinfo,
fragments, invalid percent escapes, invalid DNS/IPv4 authorities (including DNS
terminal dots), and unmapped sent-tech.ca hosts with `client_policy_invalid`.
Selftests cross-check the sentropic/auth pairs against existing ingress overlays.

D4. Public source means auth method none, has_secret=false, require_pkce=true.
Insert with null hash and a fresh preprod ID. Existing public target must have
none/null. Confidential source means basic/post with has_secret=true; existing
target must have the same method and a non-null preprod hash. Preserve it exactly.
Skip a new confidential client and count `clients_skipped_confidential`; never
insert a confidential client without its independent secret. Reject ambiguous
classifications or class changes with `client_policy_invalid`.

D5. Copy the approved configuration and timestamps; map owner_user_id through
synced users (or null when absent). Coalesce null tenant_id to sentropic and fail
closed if the tenant FK is unavailable. Changed-row upsert by target client_id
must be idempotent. Keep every existing client's id and secret hash unchanged.

D6. Keep the whole-client DV5 check across identity/rekey operations BEFORE the
client pass. At the end protect whole rows of all clients outside the desired
write set, all existing client IDs/hashes and all signing keys. Exact desired
configuration is checked with EXCEPT both ways; mismatch raises
`client_postcondition_failed`. All passes share advisory lock 799, one SQL
transaction, backup/freshness/manifest guards, DRY_RUN rollback and CONFIRM gate.

D7. Audit adds clients_upserted, clients_removed, clients_skipped_confidential.
Counts are mandatory nonnegative safe integers in the CI whitelist. Failure
messages contain only known codes. No CSV, URI, hash or arbitrary SQL diagnostic
is published. No prod run, publishing or merge is authorized by this task.

## Acceptance and checks

Fixtures export public immo-mcp with scopes immo:read, immo:search,
immo:documents:read, none/null/S256, the unchanged Claude callback, and prod
resource https://immo.sent-tech.ca/mcp. Import with ALLOWED_CLIENTS=immo-mcp must
produce https://preprod.immo.sent-tech.ca/mcp and rollback completely in dry-run.
The SQL fixture gate exports the committed synthetic row to a temporary artifact;
a Node selftest invokes the real authorize handler with that row and verifies
302 to preprod login. Negative checks prove the missing-client 400 and prod
resource rejection. Existing bundle/control selftests and sql-test.sh prove
allowlist default, secret preservation, skip, host policy, owner FK, rollback,
postcondition tamper rejection and zero-change rerun. CI runs both make gates.

The only Makefile exception extends the existing isolated SQL test target with
the Node acceptance check. No application source, dependencies or migration change.
