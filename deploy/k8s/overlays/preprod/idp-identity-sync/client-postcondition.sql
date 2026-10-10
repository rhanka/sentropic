-- Exact configuration and secret postconditions, after every transaction pass.
DO $$
BEGIN
  IF EXISTS ((SELECT to_jsonb(d) - 'has_secret' FROM desired_clients d
              EXCEPT SELECT to_jsonb(c) - ARRAY['id', 'client_secret_hash'] FROM oauth_clients c
                     WHERE c.client_id IN (SELECT client_id FROM desired_clients))
             UNION ALL
             (SELECT to_jsonb(c) - ARRAY['id', 'client_secret_hash'] FROM oauth_clients c
              WHERE c.client_id IN (SELECT client_id FROM desired_clients)
              EXCEPT SELECT to_jsonb(d) - 'has_secret' FROM desired_clients d))
     OR EXISTS (SELECT FROM desired_clients d JOIN oauth_clients c USING (client_id)
                WHERE NOT d.has_secret AND c.client_secret_hash IS NOT NULL)
    THEN RAISE EXCEPTION 'client post-condition failed'; END IF;
END $$;
