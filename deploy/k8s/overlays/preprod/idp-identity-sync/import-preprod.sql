-- Preprod-side identity sync: prod users + webauthn public keys -> preprod IdP DB (model A:
-- same user IDs as prod). Idempotent; one transaction; fail-closed (any violation => ROLLBACK).
-- Runs in ns `sentropic-preprod` with cwd=/work/in holding users.csv / webauthn.csv / snapshot.csv
-- fetched from the S3 relay (written by the PROD export CronJob) and checked against SHA256SUMS.
-- psql variables: -v dry_run=1 (default) rolls back at the end; -v dry_run=0 commits.
--
-- NEVER touched (DV5): oauth_clients (incl. radar-immobilier-preprod), id_token_signing_keys,
-- oauth codes/tokens/consents, and sessions/challenges/magic-links of any user EXCEPT the
-- preprod-only duplicates being re-keyed (their ephemeral auth artefacts are dropped).
-- Additive: preprod-only users with no email collision are kept.
\set ON_ERROR_STOP on
\if :{?dry_run}
\else
  \set dry_run 1
\endif
\if :{?allowed_rekey}
\else
  \set allowed_rekey ''
\endif

BEGIN;
SELECT pg_advisory_xact_lock(799);   -- serialize any two runs (scheduled + triggered)
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Invariant snapshot (asserted unchanged at the end).
CREATE TEMP TABLE inv_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM oauth_clients) AS clients,
       (SELECT md5(string_agg(client_id || ':' || coalesce(client_secret_hash,'') || ':' || array_to_string(redirect_uris, ','), '|' ORDER BY client_id)) FROM oauth_clients) AS clients_fp,
       (SELECT count(*) FROM id_token_signing_keys) AS signing_keys;

CREATE TEMP TABLE src_users (LIKE users INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE src_webauthn (LIKE webauthn_credentials INCLUDING DEFAULTS) ON COMMIT DROP;
\copy src_users (id, email, display_name, role, account_status, approval_due_at, approved_at, approved_by_user_id, disabled_at, disabled_reason, email_verified, created_at, updated_at) FROM 'users.csv' WITH (FORMAT csv, HEADER true)
\copy src_webauthn (id, credential_id, public_key_cose, counter, user_id, device_name, transports_json, uv, created_at, last_used_at) FROM 'webauthn.csv' WITH (FORMAT csv, HEADER true)

-- Guard: refuse an empty / truncated export (expected counts come from the export snapshot,
-- passed as -v expected_users=N -v expected_webauthn=M).
SELECT set_config('sync.expected_users', :'expected_users', true),
       set_config('sync.expected_webauthn', :'expected_webauthn', true) \gset sync_
DO $$
BEGIN
  IF (SELECT count(*) FROM src_users) = 0 THEN RAISE EXCEPTION 'empty users export'; END IF;
  IF (SELECT count(*) FROM src_users) <> current_setting('sync.expected_users')::int
     OR (SELECT count(*) FROM src_webauthn) <> current_setting('sync.expected_webauthn')::int
  THEN RAISE EXCEPTION 'export row count does not match manifest'; END IF;
END $$;

-- Audit sets captured before any change (IDs only).
CREATE TEMP TABLE audit_new_ids ON COMMIT DROP AS
SELECT id FROM src_users WHERE id NOT IN (SELECT id FROM users);
CREATE TEMP TABLE audit_preprod_only ON COMMIT DROP AS
SELECT id FROM users WHERE id NOT IN (SELECT id FROM src_users);

-- 1. Collisions: preprod rows holding a prod email under a DIFFERENT id.
CREATE TEMP TABLE collide ON COMMIT DROP AS
SELECT p.id AS old_id, s.id AS new_id
FROM users p JOIN src_users s ON lower(p.email) = lower(s.email) AND p.id <> s.id;

-- Free the emails first (users.email is UNIQUE and nullable), so the upsert cannot conflict.
UPDATE users SET email = NULL, updated_at = now() WHERE id IN (SELECT old_id FROM collide);

-- 2. Upsert prod users by id (approved_by_user_id in a 2nd pass: self-FK ordering).
INSERT INTO users (id, email, display_name, role, account_status, approval_due_at, approved_at,
                   approved_by_user_id, disabled_at, disabled_reason, email_verified, created_at, updated_at)
SELECT id, email, display_name, role, account_status, approval_due_at, approved_at,
       NULL, disabled_at, disabled_reason, email_verified, created_at, updated_at
FROM src_users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, display_name = EXCLUDED.display_name, role = EXCLUDED.role,
  account_status = EXCLUDED.account_status, approval_due_at = EXCLUDED.approval_due_at,
  approved_at = EXCLUDED.approved_at, disabled_at = EXCLUDED.disabled_at,
  disabled_reason = EXCLUDED.disabled_reason, email_verified = EXCLUDED.email_verified,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

UPDATE users u SET approved_by_user_id = s.approved_by_user_id
FROM src_users s
WHERE u.id = s.id AND u.approved_by_user_id IS DISTINCT FROM s.approved_by_user_id;

-- 3. Re-key preprod-only duplicates (old_id not itself a prod id) onto the prod id.
CREATE TEMP TABLE rekey ON COMMIT DROP AS
SELECT old_id, new_id FROM collide WHERE old_id NOT IN (SELECT id FROM src_users);

-- Guard: only re-key pairs explicitly covered by the owner GO (-v allowed_rekey='old>new,old>new').
-- Default empty: a scheduled run meeting a NEW collision fails closed and escalates.
SELECT set_config('sync.allowed_rekey', :'allowed_rekey', true) \gset sync_
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM rekey
             WHERE (old_id || '>' || new_id) <> ALL (string_to_array(current_setting('sync.allowed_rekey'), ',')))
  THEN RAISE EXCEPTION 're-key not covered by allowed_rekey: %',
         (SELECT string_agg(old_id || '>' || new_id, ',') FROM rekey); END IF;
END $$;

-- 3a. Ephemeral auth artefacts of the duplicate are dropped, not moved (DV5 spirit).
SELECT 'rekey_dropped_sessions', count(*) FROM user_sessions WHERE user_id IN (SELECT old_id FROM rekey);
SELECT 'rekey_moved_webauthn', count(*) FROM webauthn_credentials WHERE user_id IN (SELECT old_id FROM rekey);
DELETE FROM user_sessions       WHERE user_id IN (SELECT old_id FROM rekey);
DELETE FROM webauthn_challenges WHERE user_id IN (SELECT old_id FROM rekey);
DELETE FROM magic_links         WHERE user_id IN (SELECT old_id FROM rekey);
-- 3b. Every other single-column FK to users.id is repointed (discovered from the catalog, so
--     schema drift is covered). A unique violation here aborts the whole sync (fail-closed).
DO $$
DECLARE fk record; m record; n bigint;
BEGIN
  FOR m IN SELECT old_id, new_id FROM rekey LOOP
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass AND cardinality(c.conkey) = 1
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col) USING m.new_id, m.old_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE 'rekey % -> %: %.% rows=%', m.old_id, m.new_id, fk.tbl, fk.col, n; END IF;
    END LOOP;
  END LOOP;
END $$;
DELETE FROM users WHERE id IN (SELECT old_id FROM rekey);
