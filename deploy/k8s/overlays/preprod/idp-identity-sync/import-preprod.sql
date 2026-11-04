-- Preprod-side protocol sync, phase 2 of the CM replacement (a4-cm-gaps-r2 §9.2).
-- Identity itself converges in phase 1 (the identity-replica-sync runner over the
-- CM replica batch); this file converges only the APP protocol registries behind
-- the same guards: client policy/sync, service policy/sync, workload registration,
-- app-consent convergence. Idempotent; one transaction; fail-closed (any violation
-- => ROLLBACK). No legacy identity write survives here: no users, no WebAuthn, no
-- re-key, no counter merge, no FK repoint loop.
-- Runs in ns `sentropic-preprod` with cwd=/work/in holding identity-replica-batch.json,
-- consents.csv, clients.csv and snapshot.csv fetched from the S3 relay (written by
-- the PROD export) and checked against SHA256SUMS.
-- psql variables: -v dry_run=1 (default) rolls back at the end; -v dry_run=0 commits.
--
-- Protected (DV5): unselected oauth_clients, existing client IDs/secrets,
-- id_token_signing_keys, oauth codes/tokens.
-- Mapped prod consents converge in step 6 for mapped clients and replica users.
\set ON_ERROR_STOP on
\if :{?dry_run}
\else
  \set dry_run 1
\endif

BEGIN;
SELECT pg_advisory_xact_lock(799);   -- serialize any two runs (scheduled + triggered)
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Acquire every client guard, including client creation races.
CREATE TEMP TABLE refresh_sync_map (prod_client_id text, preprod_client_id text) ON COMMIT DROP;
\copy refresh_sync_map FROM '/sql/client-map.csv' WITH (FORMAT csv, HEADER true)
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT client_id FROM oauth_clients UNION SELECT preprod_client_id FROM refresh_sync_map ORDER BY 1 LOOP
    PERFORM public.oauth_refresh_client_guard(c, true);
  END LOOP;
END $$;

-- Invariant snapshot (asserted unchanged at the end).
CREATE TEMP TABLE inv_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM oauth_clients) AS clients,
       (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM oauth_clients t) AS clients_fp,
       (SELECT count(*) FROM id_token_signing_keys) AS signing_keys,
       (SELECT md5(string_agg(t::text, '|' ORDER BY t.kid)) FROM id_token_signing_keys t) AS signing_keys_fp;
CREATE TEMP TABLE clients_before ON COMMIT DROP AS TABLE oauth_clients;

-- Replica user ids converged by phase 1 (the CM sync receipt proves convergence;
-- this temp only scopes the step-6 app-consent convergence to replica users).
CREATE TEMP TABLE src_replica_users (id text) ON COMMIT DROP;
\copy src_replica_users FROM 'replica-users.csv' WITH (FORMAT csv, HEADER true)
SELECT set_config('sync.expected_accounts', :'expected_accounts', true) \gset sync_
DO $$
BEGIN
  IF (SELECT count(*) FROM src_replica_users) = 0 THEN RAISE EXCEPTION 'empty identity replica export'; END IF;
  IF (SELECT count(*) FROM src_replica_users) <> current_setting('sync.expected_accounts')::int
  THEN RAISE EXCEPTION 'export row count does not match manifest'; END IF;
END $$;

-- 5. Phase-1 CM sync must preserve the complete original client table.
DO $$
BEGIN
  IF (SELECT row(clients, clients_fp) FROM inv_before) IS DISTINCT FROM
     (SELECT row(count(*), md5(string_agg(t::text, '|' ORDER BY t.id))) FROM oauth_clients t)
    THEN RAISE EXCEPTION 'post: DV5 invariant changed (oauth_clients / signing keys)'; END IF;
END $$;
CREATE TEMP TABLE client_map (prod_client_id text, preprod_client_id text) ON COMMIT DROP;
\copy client_map FROM '/sql/client-map.csv' WITH (FORMAT csv, HEADER true)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM client_map)
     OR EXISTS (SELECT FROM client_map WHERE coalesce(prod_client_id, '') = '' OR coalesce(preprod_client_id, '') = '')
     OR EXISTS (SELECT FROM client_map GROUP BY prod_client_id HAVING count(*) > 1)
     OR EXISTS (SELECT FROM client_map GROUP BY preprod_client_id HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'consent client map target missing'; END IF;
END $$;
\i /sql/client-policy.sql
\i /sql/sync-clients.sql
\i /sql/service-policy.sql
\i /sql/sync-services.sql

-- 6. Explicit prod consents converge only for mapped clients and replica users.
CREATE TEMP TABLE src_consents (LIKE oauth_consents INCLUDING DEFAULTS) ON COMMIT DROP;
\copy src_consents (user_id, client_id, tenant_id, scopes, created_at, updated_at) FROM 'consents.csv' WITH (FORMAT csv, HEADER true)
SELECT set_config('sync.expected_consents', :'expected_consents', true) \gset sync_
DO $$
BEGIN
  IF (SELECT count(*) FROM src_consents) <> current_setting('sync.expected_consents')::int
    THEN RAISE EXCEPTION 'export row count does not match manifest'; END IF;
  IF EXISTS (SELECT FROM client_map m LEFT JOIN oauth_clients c ON c.client_id = m.preprod_client_id
             WHERE c.client_id IS NULL)
    THEN RAISE EXCEPTION 'consent client map target missing'; END IF;
END $$;
CREATE TEMP TABLE desired_consents ON COMMIT DROP AS
SELECT s.user_id, m.preprod_client_id AS client_id, s.tenant_id, s.scopes, s.created_at, s.updated_at
FROM src_consents s JOIN client_map m ON m.prod_client_id = s.client_id
WHERE s.user_id IN (SELECT id FROM src_replica_users);
WITH written AS (
  INSERT INTO oauth_consents (user_id, client_id, tenant_id, scopes, created_at, updated_at)
  SELECT user_id, client_id, tenant_id, scopes, created_at, updated_at FROM desired_consents
  ON CONFLICT (user_id, client_id, tenant_id) DO UPDATE SET
    scopes = EXCLUDED.scopes, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
  WHERE (oauth_consents.scopes, oauth_consents.created_at, oauth_consents.updated_at)
    IS DISTINCT FROM (EXCLUDED.scopes, EXCLUDED.created_at, EXCLUDED.updated_at)
  RETURNING 1
)
SELECT 'consents_upserted', count(*) FROM written;
WITH removed AS (
  DELETE FROM oauth_consents c
  WHERE c.user_id IN (SELECT id FROM src_replica_users) AND c.client_id IN (SELECT preprod_client_id FROM client_map)
    AND NOT EXISTS (SELECT FROM desired_consents d
                    WHERE (d.user_id, d.client_id, d.tenant_id) = (c.user_id, c.client_id, c.tenant_id))
  RETURNING 1
)
SELECT 'consents_removed', count(*) FROM removed;
CREATE TEMP TABLE actual_consents ON COMMIT DROP AS
SELECT c.user_id, c.client_id, c.tenant_id, c.scopes, c.created_at, c.updated_at
FROM oauth_consents c
WHERE c.user_id IN (SELECT id FROM src_replica_users) AND c.client_id IN (SELECT preprod_client_id FROM client_map);
DO $$
BEGIN
  IF EXISTS ((SELECT * FROM desired_consents EXCEPT SELECT * FROM actual_consents)
             UNION ALL (SELECT * FROM actual_consents EXCEPT SELECT * FROM desired_consents))
    THEN RAISE EXCEPTION 'consent post-condition failed'; END IF;
END $$;

-- 7. Post-conditions (inside the transaction: any failure rolls everything back).
\i /sql/client-postcondition.sql
-- Identity convergence is proved by the phase-1 CM sync receipt (the runner refuses
-- to run phase 2 unless phase 1 committed or rolled back a validated batch); the
-- remaining post-conditions below guard the protocol registries only.
DO $$
BEGIN
  IF EXISTS (SELECT FROM clients_before b LEFT JOIN oauth_clients c USING (client_id)
             WHERE c.id IS DISTINCT FROM b.id OR c.client_secret_hash IS DISTINCT FROM b.client_secret_hash)
     OR EXISTS ((SELECT * FROM clients_before WHERE client_id NOT IN (SELECT client_id FROM desired_clients)
                 EXCEPT SELECT * FROM oauth_clients WHERE client_id NOT IN (SELECT client_id FROM desired_clients))
                UNION ALL
                (SELECT * FROM oauth_clients WHERE client_id NOT IN (SELECT client_id FROM desired_clients)
                 EXCEPT SELECT * FROM clients_before WHERE client_id NOT IN (SELECT client_id FROM desired_clients)))
     OR (SELECT row(signing_keys, signing_keys_fp) FROM inv_before) IS DISTINCT FROM
        (SELECT row(count(*), md5(string_agg(t::text, '|' ORDER BY t.kid))) FROM id_token_signing_keys t)
    THEN RAISE EXCEPTION 'post: DV5 invariant changed (oauth_clients / signing keys)'; END IF;
END $$;
-- 7a. Service clients: every row except the workload exchange_policy is byte-identical,
-- so the workload keeps its local id and secret hash (sync-services.sql already proved it).
DO $$
BEGIN
  IF EXISTS ((SELECT to_jsonb(s) - 'exchange_policy' FROM services_before s
              EXCEPT SELECT to_jsonb(c) - 'exchange_policy' FROM service_clients c)
             UNION ALL
             (SELECT to_jsonb(c) - 'exchange_policy' FROM service_clients c
              EXCEPT SELECT to_jsonb(s) - 'exchange_policy' FROM services_before s))
    THEN RAISE EXCEPTION 'post: service_clients invariant changed'; END IF;
END $$;

-- Audit (IDs and counts only; identity counts come from the phase-1 runner lines).
SELECT 'synced_replica_users', count(*) FROM src_replica_users;

\if :dry_run
  ROLLBACK;
  \echo 'DRY RUN: rolled back'
\else
  COMMIT;
  \echo 'COMMITTED'
\endif
