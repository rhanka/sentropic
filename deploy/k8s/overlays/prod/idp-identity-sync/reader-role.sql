-- Idempotent identity-export login; password comes from the pod Secret environment.
-- Keep log_statement=none: the ALTER ROLE wire statement contains the password.
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
ALTER ROLE idp_identity_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD :'pw';
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
GRANT SELECT (id, email, display_name, role, account_status, approval_due_at, approved_at, approved_by_user_id,
              disabled_at, disabled_reason, email_verified, created_at, updated_at) ON users TO idp_identity_reader;
GRANT SELECT (id, credential_id, public_key_cose, counter, user_id, device_name, transports_json, uv,
              created_at, last_used_at) ON webauthn_credentials TO idp_identity_reader;
GRANT SELECT (user_id, client_id, tenant_id, scopes, created_at, updated_at) ON oauth_consents TO idp_identity_reader;
GRANT SELECT (client_id, name, redirect_uris, allowed_scopes, grant_types, response_types,
              token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce, resource_indicators,
              tenant_id, owner_user_id, created_at, updated_at) ON oauth_clients TO idp_identity_reader;
GRANT SELECT (client_id, has_secret) ON idp_oauth_client_secret_presence TO idp_identity_reader;
COMMIT;
-- Evidence (no secret): role attributes and exact column grants.
SELECT rolname, rolcanlogin, rolsuper, rolconnlimit, rolconfig FROM pg_roles WHERE rolname = 'idp_identity_reader';
SELECT table_name, count(*) AS granted_columns FROM information_schema.column_privileges
WHERE grantee = 'idp_identity_reader' GROUP BY table_name ORDER BY table_name;
