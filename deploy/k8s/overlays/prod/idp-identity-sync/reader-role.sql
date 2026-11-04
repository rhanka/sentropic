-- Idempotent protocol-export login; password comes from the pod Secret environment.
-- Keep log_statement=none: the ALTER ROLE wire statement contains the password.
-- CM identity is exported by the api runner over the app credentials; this role
-- only serves the psql protocol leg, so legacy identity grants stay revoked.
\set ON_ERROR_STOP on
\set pw ''
\getenv pw RO_PASSWORD
SELECT length(:'pw') > 0 AS ro_ok \gset
\if :ro_ok
\else
  \warn 'FATAL: RO_PASSWORD empty/unset; refusing a passwordless reader'
  DO $guard$ BEGIN RAISE EXCEPTION 'RO_PASSWORD env empty/unset (fail-closed)'; END $guard$;
\endif

BEGIN;
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idp_identity_reader') AS need_create \gset
\if :need_create
  CREATE ROLE idp_identity_reader LOGIN CONNECTION LIMIT 2;
\endif
ALTER ROLE idp_identity_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD :'pw';
ALTER ROLE idp_identity_reader SET default_transaction_read_only = on;
ALTER ROLE idp_identity_reader SET statement_timeout = '60s';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM idp_identity_reader;
-- Column ACLs survive a table-level REVOKE; explicitly remove the older hash grant.
REVOKE SELECT (client_secret_hash) ON oauth_clients FROM idp_identity_reader;
CREATE OR REPLACE VIEW idp_oauth_client_secret_presence
WITH (security_barrier = true, security_invoker = false) AS
SELECT client_id, client_secret_hash IS NOT NULL AS has_secret FROM oauth_clients;
REVOKE ALL ON idp_oauth_client_secret_presence FROM PUBLIC;
GRANT CONNECT ON DATABASE app TO idp_identity_reader;
GRANT USAGE ON SCHEMA public TO idp_identity_reader;
-- Legacy identity tables are gone from the export: no grant on users or
-- webauthn_credentials. Roles created by older revisions keep their column
-- grants until the cutover drops the tables, hence the conditional revoke.
DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN REVOKE ALL ON users FROM idp_identity_reader; END IF;
  IF to_regclass('public.webauthn_credentials') IS NOT NULL THEN REVOKE ALL ON webauthn_credentials FROM idp_identity_reader; END IF;
END $$;
GRANT SELECT (user_id, client_id, tenant_id, scopes, created_at, updated_at) ON oauth_consents TO idp_identity_reader;
GRANT SELECT (client_id, name, redirect_uris, allowed_scopes, grant_types, response_types,
              token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce, resource_indicators,
              tenant_id, owner_user_id, created_at, updated_at) ON oauth_clients TO idp_identity_reader;
GRANT SELECT (client_id, has_secret) ON idp_oauth_client_secret_presence TO idp_identity_reader;
-- CM replica export: read-only grants pinned to the four CM tables the exporter
-- reads (a4-cm-gaps-r2 §9.2; names pinned from the custody schema asset).
-- Column-level so a later CM table never inherits this role. Conditional:
-- pre-cutover tiers have no cm_identity schema yet (the export CronJob stays
-- suspended until the cutover lands on both tiers).
DO $$ BEGIN
  IF to_regclass('cm_identity.identity_user_accounts') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA cm_identity TO idp_identity_reader;
    GRANT SELECT (user_id, email, account_status, global_role, created_at, updated_at)
      ON cm_identity.identity_user_accounts TO idp_identity_reader;
    GRANT SELECT (user_id, email_verified, display_name, approval_due_at, approved_at,
                  approved_by_user_id, disabled_at, disabled_reason, legacy_account_status)
      ON cm_identity.identity_account_profiles TO idp_identity_reader;
    GRANT SELECT (proof_id, user_id, credential_id, public_key_cose, counter, revision,
                  rp_id, device_name, transports_json, uv, device_type, backed_up,
                  created_at, last_used_at, revoked_at)
      ON cm_identity.identity_webauthn_credentials TO idp_identity_reader;
    GRANT SELECT (consent_id, tenant_id, user_id, client_id, granted_at, revoked_at)
      ON cm_identity.cm_oauth_consents TO idp_identity_reader;
  END IF;
END $$;
COMMIT;
-- Evidence (no secret): role attributes and exact column grants.
SELECT rolname, rolcanlogin, rolsuper, rolconnlimit, rolconfig FROM pg_roles WHERE rolname = 'idp_identity_reader';
SELECT table_name, count(*) AS granted_columns FROM information_schema.column_privileges
WHERE grantee = 'idp_identity_reader' GROUP BY table_name ORDER BY table_name;
