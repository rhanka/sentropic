-- Static reviewed desired exchange policy for the workload client (2-IdP, R2).
-- Runs AFTER client-policy.sql: reuses host_map and pg_temp.rewrite_client_uri.
-- Prod audiences below; preprod rewrite happens in transformed_service_policy.
-- No secrets in this file: only audiences, scopes, actor, TTL and environment.
CREATE TEMP TABLE desired_service_policy_raw ON COMMIT DROP AS
SELECT 'immo-mcp-workload'::text AS client_id,
  '{"enabled": true, "allowedSubjectClients": ["immo-mcp"], "allowedSubjectAudiences": ["https://immo.sent-tech.ca/mcp"], "allowedTargetAudiences": ["https://immo.sent-tech.ca"], "actorSub": "immo-mcp-workload", "allowedScopes": ["immo:read", "immo:search"], "maxTtlSeconds": 300, "environment": null, "allowClientCredentials": false}'::jsonb AS exchange_policy;
DO $$
DECLARE policy jsonb;
BEGIN
  IF (SELECT count(*) FROM desired_service_policy_raw) <> 1 THEN RAISE EXCEPTION 'service policy invalid'; END IF;
  SELECT exchange_policy INTO policy FROM desired_service_policy_raw;
  IF NOT (policy ?& ARRAY['enabled', 'allowedSubjectClients', 'allowedSubjectAudiences', 'allowedTargetAudiences', 'actorSub', 'allowedScopes', 'maxTtlSeconds', 'allowClientCredentials'])
     OR (policy->>'enabled')::boolean IS DISTINCT FROM true
     OR jsonb_array_length(policy->'allowedSubjectClients') = 0
     OR jsonb_array_length(policy->'allowedSubjectAudiences') = 0
     OR jsonb_array_length(policy->'allowedTargetAudiences') = 0
     OR jsonb_array_length(policy->'allowedScopes') = 0
     OR coalesce(policy->>'actorSub', '') = ''
     OR (policy->>'maxTtlSeconds')::int NOT BETWEEN 1 AND 300
     OR (policy->>'allowClientCredentials')::boolean IS DISTINCT FROM false
    THEN RAISE EXCEPTION 'service policy invalid'; END IF;
END $$;
CREATE TEMP TABLE transformed_service_policy ON COMMIT DROP AS
SELECT client_id,
  jsonb_build_object(
    'enabled', true,
    'allowedSubjectClients', exchange_policy->'allowedSubjectClients',
    'allowedSubjectAudiences', (SELECT jsonb_agg(pg_temp.rewrite_client_uri(value)) FROM jsonb_array_elements_text(exchange_policy->'allowedSubjectAudiences') AS value),
    'allowedTargetAudiences', (SELECT jsonb_agg(pg_temp.rewrite_client_uri(value)) FROM jsonb_array_elements_text(exchange_policy->'allowedTargetAudiences') AS value),
    'actorSub', exchange_policy->>'actorSub',
    'allowedScopes', exchange_policy->'allowedScopes',
    'maxTtlSeconds', (exchange_policy->>'maxTtlSeconds')::int,
    'environment', exchange_policy->'environment',
    'allowClientCredentials', false
  ) AS exchange_policy
FROM desired_service_policy_raw;
CREATE TEMP TABLE services_before ON COMMIT DROP AS TABLE service_clients;
