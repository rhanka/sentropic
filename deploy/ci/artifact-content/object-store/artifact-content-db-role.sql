-- PREPROD ONLY: login role of the artifact-content service (database app).
-- Idempotent, same shape as overlays/prod/idp-identity-sync/reader-role.sql.
-- The operator feeds `\set pw '<hex>'` and this file on psql STDIN inside postgres-0
-- (README.md), so the password never reaches a command line, an exec URL or a log;
-- log_statement is forced to none for this session because ALTER ROLE carries it.
--
-- Surface (apps/artifact-content/src/runtime.ts content path, reader-activation.ts):
--   read artifacts (published artifact data), control.artifact_host_kv (scope map),
--   four cm_identity tables (membership approval), the activation migration receipt,
--   and SELECT + DELETE on artifact_host.activation_tickets. No DDL, no publication
--   authority, no write to artifacts, cm_identity or control, no other identity table.
-- NOT granted (open finding, fail-closed): the activation consume transaction also
-- needs artifact_host.activation_namespaces SELECT + INSERT + UPDATE (ON CONFLICT
-- insert, FOR SHARE), artifact_host.browser_flows SELECT + UPDATE (peek, FOR UPDATE),
-- artifact_host.activation_tickets UPDATE (FOR UPDATE), and UPDATE privilege for the
-- FOR SHARE row locks of currentPolicy on artifacts.{artifacts,releases,
-- artifact_current,artifact_access} and the four cm_identity tables. That write
-- surface is an architecture decision, not an operator grant.
\set ON_ERROR_STOP on
SET log_statement = 'none';
SELECT length(:'pw') >= 32 AS pw_ok \gset
\if :pw_ok
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'pw shorter than 32 characters (fail-closed)'; END $guard$;
\endif

BEGIN;
SET LOCAL statement_timeout = '60s';
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'artifact_content') AS need_create \gset
\if :need_create
  CREATE ROLE artifact_content LOGIN;
\endif
ALTER ROLE artifact_content WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 12 PASSWORD :'pw';
ALTER ROLE artifact_content SET statement_timeout = '30s';
GRANT CONNECT ON DATABASE app TO artifact_content;
GRANT USAGE ON SCHEMA artifacts, control, cm_identity, artifact_host TO artifact_content;
GRANT SELECT ON ALL TABLES IN SCHEMA artifacts TO artifact_content;
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA artifacts GRANT SELECT ON TABLES TO artifact_content;
GRANT SELECT ON control.artifact_host_kv TO artifact_content;
GRANT SELECT ON cm_identity.identity_user_accounts, cm_identity.identity_account_profiles,
  cm_identity.cm_tenant_memberships, cm_identity.cm_tenants TO artifact_content;
GRANT SELECT ON public.__drizzle_control_migrations TO artifact_content;
GRANT SELECT, DELETE ON artifact_host.activation_tickets TO artifact_content;
COMMIT;
SELECT 'role', rolname, rolcanlogin, rolsuper, rolconnlimit FROM pg_roles WHERE rolname = 'artifact_content';
