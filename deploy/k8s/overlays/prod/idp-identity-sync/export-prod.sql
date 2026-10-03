-- Prod-side identity export (runs in ns `sentropic` as role idp_identity_exporter, READ ONLY).
-- Exports ONLY identity rows: users + webauthn public keys. No sessions, tokens, codes,
-- magic-links, oauth_clients or signing keys (DV5).
-- Invoked: psql -XAtq -v ON_ERROR_STOP=1 -f export-prod.sql   (cwd = /work)
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;  -- one consistent snapshot for both files
\copy (SELECT id, email, display_name, role, account_status, approval_due_at, approved_at, approved_by_user_id, disabled_at, disabled_reason, email_verified, created_at, updated_at FROM users ORDER BY id) TO 'users.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT id, credential_id, public_key_cose, counter, user_id, device_name, transports_json, uv, created_at, last_used_at FROM webauthn_credentials ORDER BY id) TO 'webauthn.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT now() AT TIME ZONE 'UTC', (SELECT count(*) FROM users), (SELECT count(*) FROM webauthn_credentials)) TO 'snapshot.csv' WITH (FORMAT csv)
COMMIT;
