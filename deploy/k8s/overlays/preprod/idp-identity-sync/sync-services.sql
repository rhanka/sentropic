-- Policy-only pass, after register-workload.sql applies the named Secret hash.
-- This pass preserves ids/hashes; registration/rekey occurs before services_before.
-- Without a Secret, missing rows remain services_skipped_missing; nothing is minted.
WITH written AS (
  UPDATE service_clients c SET exchange_policy = t.exchange_policy
  FROM transformed_service_policy t WHERE c.client_id = t.client_id
  AND c.exchange_policy IS DISTINCT FROM t.exchange_policy
  RETURNING 1
)
SELECT 'services_upserted', count(*) FROM written;
SELECT 'services_skipped_missing', count(*) FROM transformed_service_policy t
WHERE NOT EXISTS (SELECT FROM service_clients c WHERE c.client_id = t.client_id);
DO $$
BEGIN
  IF EXISTS (SELECT to_jsonb(s) - 'exchange_policy' FROM services_before s
               WHERE s.client_id NOT IN (SELECT client_id FROM transformed_service_policy)
             EXCEPT SELECT to_jsonb(c) - 'exchange_policy' FROM service_clients c
               WHERE c.client_id NOT IN (SELECT client_id FROM transformed_service_policy)
             UNION ALL
             SELECT to_jsonb(c) - 'exchange_policy' FROM service_clients c
               WHERE c.client_id NOT IN (SELECT client_id FROM transformed_service_policy)
             EXCEPT SELECT to_jsonb(s) - 'exchange_policy' FROM services_before s
               WHERE s.client_id NOT IN (SELECT client_id FROM transformed_service_policy))
     OR EXISTS (SELECT FROM services_before b JOIN service_clients c USING (client_id)
                WHERE c.client_id IN (SELECT client_id FROM transformed_service_policy)
                AND (b.id IS DISTINCT FROM c.id OR b.client_secret_hash IS DISTINCT FROM c.client_secret_hash))
     OR EXISTS (SELECT to_jsonb(t) FROM transformed_service_policy t
                JOIN service_clients c USING (client_id)
                WHERE c.exchange_policy IS DISTINCT FROM t.exchange_policy)
    THEN RAISE EXCEPTION 'service post-condition failed'; END IF;
END $$;
