-- Local policy, loaded inside the identity transaction before the client upsert.
\if :{?allowed_clients}
\else
  \set allowed_clients ''
\endif
CREATE TEMP TABLE src_clients (LIKE oauth_clients INCLUDING DEFAULTS) ON COMMIT DROP;
ALTER TABLE src_clients DROP COLUMN id, DROP COLUMN client_secret_hash, ADD COLUMN has_secret boolean NOT NULL;
\copy src_clients (client_id, has_secret, name, redirect_uris, allowed_scopes, grant_types, response_types, token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce, resource_indicators, tenant_id, owner_user_id, created_at, updated_at) FROM 'clients.csv' WITH (FORMAT csv, HEADER MATCH)
SELECT set_config('sync.expected_clients', :'expected_clients', true),
       set_config('sync.allowed_clients', :'allowed_clients', true) \gset sync_
CREATE TEMP TABLE allowed_clients ON COMMIT DROP AS
SELECT trim(x) AS client_id FROM unnest(string_to_array(:'allowed_clients', ',')) x;
CREATE TEMP TABLE host_map (prod_host text, preprod_host text) ON COMMIT DROP;
\copy host_map FROM '/sql/host-map.csv' WITH (FORMAT csv, HEADER true)
DO $$
BEGIN
  IF (SELECT count(*) FROM src_clients) <> current_setting('sync.expected_clients')::bigint
    THEN RAISE EXCEPTION 'export row count does not match manifest'; END IF;
  IF EXISTS (SELECT FROM allowed_clients WHERE client_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
     OR EXISTS (SELECT FROM allowed_clients GROUP BY client_id HAVING count(*) > 1)
     OR EXISTS (SELECT FROM src_clients GROUP BY client_id HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'client policy invalid'; END IF;
  IF EXISTS (SELECT FROM allowed_clients a LEFT JOIN src_clients s USING (client_id) WHERE s.client_id IS NULL)
    THEN RAISE EXCEPTION 'client source missing'; END IF;
  IF NOT EXISTS (SELECT FROM host_map)
     OR EXISTS (SELECT FROM host_map WHERE prod_host IS NULL OR preprod_host IS NULL
                OR prod_host !~ '^[a-z0-9.-]+[.]sent-tech[.]ca$' OR prod_host LIKE 'preprod.%'
                OR preprod_host <> 'preprod.' || prod_host)
     OR EXISTS (SELECT FROM host_map GROUP BY prod_host HAVING count(*) > 1)
     OR EXISTS (SELECT FROM host_map GROUP BY preprod_host HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'client policy invalid'; END IF;
END $$;
CREATE FUNCTION pg_temp.rewrite_client_uri(uri text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE parts text[]; host text; target text; label text;
BEGIN
  -- Authority parsing prevents replacing a host-looking string inside a path/query.
  parts := regexp_match(uri, '^https://([A-Za-z0-9.-]+)(:[0-9]{1,5})?([/?][^#[:space:]]*)?$', 'i');
  IF parts IS NULL OR uri IS NULL OR strpos(uri, chr(92)) > 0 OR uri ~ '[[:cntrl:]]'
     OR strpos(regexp_replace(uri, '%[0-9A-Fa-f]{2}', '', 'g'), '%') > 0
     OR (parts[2] IS NOT NULL AND substring(parts[2] FROM 2)::int NOT BETWEEN 1 AND 65535)
    THEN RAISE EXCEPTION 'client policy invalid'; END IF;
  host := lower(parts[1]);
  -- Reject DNS terminal dots rather than silently changing an unlisted authority.
  IF length(host) > 253 THEN RAISE EXCEPTION 'client policy invalid'; END IF;
  FOREACH label IN ARRAY string_to_array(host, '.') LOOP
    IF label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      THEN RAISE EXCEPTION 'client policy invalid'; END IF;
  END LOOP;
  -- Numeric-ending hosts use URL IPv4 parsing. Accept only canonical dotted decimal.
  IF host ~ '(^|[.])([0-9]+|0x[0-9a-f]+)$' THEN
    IF host !~ '^(0|[1-9][0-9]{0,2})([.](0|[1-9][0-9]{0,2})){3}$'
      THEN RAISE EXCEPTION 'client policy invalid'; END IF;
    FOREACH label IN ARRAY string_to_array(host, '.') LOOP
      IF label::int > 255 THEN RAISE EXCEPTION 'client policy invalid'; END IF;
    END LOOP;
  END IF;
  SELECT preprod_host INTO target FROM host_map WHERE prod_host = host;
  IF target IS NOT NULL THEN RETURN 'https://' || target || coalesce(parts[2], '') || coalesce(parts[3], ''); END IF;
  IF (host = 'sent-tech.ca' OR host LIKE '%.sent-tech.ca')
     AND NOT EXISTS (SELECT FROM host_map WHERE preprod_host = host)
    THEN RAISE EXCEPTION 'client policy invalid'; END IF;
  RETURN uri; -- External callbacks and already rewritten preprod URIs stay exact.
END $$;
CREATE TEMP TABLE selected_clients ON COMMIT DROP AS
SELECT s.*, coalesce(m.preprod_client_id, s.client_id) AS target_client_id
FROM src_clients s JOIN allowed_clients a USING (client_id)
LEFT JOIN client_map m ON m.prod_client_id = s.client_id;
DO $$
BEGIN
  IF EXISTS (SELECT FROM selected_clients GROUP BY target_client_id HAVING count(*) > 1)
     OR EXISTS (SELECT FROM selected_clients s LEFT JOIN oauth_clients c ON c.client_id = s.target_client_id
                WHERE (s.token_endpoint_auth_method = 'none' AND s.require_pkce IS DISTINCT FROM true)
                   OR NOT ((s.token_endpoint_auth_method = 'none' AND NOT s.has_secret)
                           OR (s.token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post') AND s.has_secret))
                   OR (c.id IS NOT NULL AND (c.token_endpoint_auth_method <> s.token_endpoint_auth_method
                       OR (c.client_secret_hash IS NOT NULL) <> s.has_secret))
                   OR cardinality(s.redirect_uris) = 0
                   OR s.grant_types <> ARRAY['authorization_code']::text[]
                   OR s.response_types <> ARRAY['code']::text[]
                   OR NOT EXISTS (SELECT FROM tenants WHERE id = coalesce(s.tenant_id, 'sentropic')))
    THEN RAISE EXCEPTION 'client policy invalid'; END IF;
END $$;
-- Validate every selected URI, including clients skipped for independent secrets.
CREATE TEMP TABLE transformed_clients ON COMMIT DROP AS
SELECT s.target_client_id AS client_id, s.has_secret, s.name,
       ARRAY(SELECT pg_temp.rewrite_client_uri(uri) FROM unnest(s.redirect_uris) uri) AS redirect_uris,
       s.allowed_scopes, s.grant_types, s.response_types, s.token_endpoint_auth_method,
       s.dpop_bound_access_tokens, s.require_pkce,
       ARRAY(SELECT pg_temp.rewrite_client_uri(uri) FROM unnest(s.resource_indicators) uri) AS resource_indicators,
       coalesce(s.tenant_id, 'sentropic') AS tenant_id, u.id AS owner_user_id, s.created_at, s.updated_at
FROM selected_clients s LEFT JOIN users u ON u.id = s.owner_user_id;
CREATE TEMP TABLE desired_clients ON COMMIT DROP AS
SELECT t.* FROM transformed_clients t
WHERE NOT t.has_secret OR EXISTS (SELECT FROM oauth_clients c WHERE c.client_id = t.client_id);
SELECT 'clients_skipped_confidential', count(*) FROM transformed_clients WHERE client_id NOT IN (SELECT client_id FROM desired_clients);
