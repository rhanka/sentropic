-- ARCH-11 G1a — residual persisted scope re-key (spec §4.1.7).
-- Public G1a migration 0038 and control migration 0003 already established the real
-- workspace → tenant mapping. Re-key only proven legacy aliases; unresolved rows deny by
-- remaining untouched rather than guessing a tenant.

WITH candidates AS (
  SELECT
    e."id",
    e."workspace_id",
    e."tenant_id" AS "previous_tenant_id",
    w."tenant_id" AS "resolved_tenant_id",
    CASE
      WHEN e."envelope" #>> '{scope,tenantId}' = e."workspace_id" THEN
        jsonb_set(
          CASE
            WHEN e."envelope" #>> '{tenant,tenantId}' = e."workspace_id"
              THEN jsonb_set(e."envelope", '{tenant,tenantId}', to_jsonb(w."tenant_id"), false)
            ELSE e."envelope"
          END,
          '{scope,tenantId}',
          to_jsonb(w."tenant_id"),
          false
        )
      WHEN e."envelope" #>> '{tenant,tenantId}' = e."workspace_id"
        THEN jsonb_set(e."envelope", '{tenant,tenantId}', to_jsonb(w."tenant_id"), false)
      ELSE e."envelope"
    END AS "rekeyed_envelope"
  FROM "control"."event_outbox" e
  JOIN "workspaces" w ON w."id" = e."workspace_id"
  WHERE e."tenant_id" = e."workspace_id"
), rekeyed AS (
  UPDATE "control"."event_outbox" e
  SET
    "tenant_id" = c."resolved_tenant_id",
    "envelope" = c."rekeyed_envelope"
  FROM candidates c
  WHERE e."id" = c."id"
  RETURNING c."workspace_id", c."previous_tenant_id", c."resolved_tenant_id"
), rekeyed_workspaces AS (
  SELECT
    "workspace_id",
    "previous_tenant_id",
    "resolved_tenant_id",
    count(*)::int AS "rekeyed_rows"
  FROM rekeyed
  GROUP BY "workspace_id", "previous_tenant_id", "resolved_tenant_id"
)
INSERT INTO "control"."event_outbox" (
  "id", "aggregate_type", "aggregate_id", "seq", "envelope", "tenant_id",
  "workspace_id", "status", "attempts", "channel", "created_at"
)
SELECT
  'arch11-g1a-rekey:' || md5(r."workspace_id" || ':' || r."resolved_tenant_id"),
  'tenant_rekey',
  r."workspace_id",
  1,
  jsonb_build_object(
    'type', 'tenant.rekeyed',
    'seq', 1,
    'ts', now(),
    'tenant', jsonb_build_object(
      'tenantId', r."resolved_tenant_id",
      'workspaceId', r."workspace_id",
      'userId', 'system:arch11-g1a'
    ),
    'payload', jsonb_build_object(
      'previousTenantId', r."previous_tenant_id",
      'rekeyedRows', r."rekeyed_rows"
    )
  ),
  r."resolved_tenant_id",
  r."workspace_id",
  'pending',
  0,
  'tenant_events',
  now()
FROM rekeyed_workspaces r
ON CONFLICT ("id") DO NOTHING;
