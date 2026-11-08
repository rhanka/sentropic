-- A-LIVE v2 §8.2/§9 generic live invitations (contract 2026-11-07): session-bound, viewing only, never a release grant.
-- Additive. The final guard refuses a pre-existing table of the same name with any other column or index, because
-- CREATE TABLE IF NOT EXISTS alone would silently keep a foreign schema.
CREATE TABLE IF NOT EXISTS artifacts.live_invitations (
  storage_scope_id text NOT NULL,
  artifact_id uuid NOT NULL,
  binding_generation bigint NOT NULL CHECK (binding_generation > 0),
  live_session_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  principal_id text NOT NULL,
  created_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'revoked', 'expired', 'ceased')),
  epoch bigint NOT NULL CHECK (epoch > 0),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  row_version bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT live_invitations_pkey PRIMARY KEY (invitation_id),
  CONSTRAINT live_invitations_artifact_fk FOREIGN KEY (artifact_id, storage_scope_id)
    REFERENCES artifacts.artifacts (id, storage_scope_id),
  CONSTRAINT live_invitations_invitee_check CHECK (principal_id <> created_by),
  CONSTRAINT live_invitations_accepted_check CHECK ((status <> 'pending' OR accepted_at IS NULL)
    AND (status <> 'active' OR accepted_at IS NOT NULL)),
  CONSTRAINT live_invitations_revoked_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS live_invitations_session_idx
  ON artifacts.live_invitations (storage_scope_id, artifact_id, binding_generation, live_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS live_invitations_open_principal_uq
  ON artifacts.live_invitations (storage_scope_id, artifact_id, binding_generation, live_session_id, principal_id)
  WHERE status IN ('pending', 'active');

-- One epoch row per live session: a revocation raises it and every open invitation of the session adopts it.
CREATE TABLE IF NOT EXISTS artifacts.live_invitation_epochs (
  storage_scope_id text NOT NULL,
  artifact_id uuid NOT NULL,
  binding_generation bigint NOT NULL CHECK (binding_generation > 0),
  live_session_id uuid NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0),
  CONSTRAINT live_invitation_epochs_pkey PRIMARY KEY (storage_scope_id, artifact_id, binding_generation, live_session_id),
  CONSTRAINT live_invitation_epochs_artifact_fk FOREIGN KEY (artifact_id, storage_scope_id)
    REFERENCES artifacts.artifacts (id, storage_scope_id)
);

-- Mandatory guard: the exact columns (information_schema.columns) and indexes (pg_indexes) of both tables.
DO $$
DECLARE drift text;
BEGIN
  WITH expected (table_name, column_name, data_type, is_nullable) AS (VALUES
    ('live_invitations', 'storage_scope_id', 'text', 'NO'), ('live_invitations', 'artifact_id', 'uuid', 'NO'),
    ('live_invitations', 'binding_generation', 'bigint', 'NO'), ('live_invitations', 'live_session_id', 'uuid', 'NO'),
    ('live_invitations', 'invitation_id', 'uuid', 'NO'), ('live_invitations', 'principal_id', 'text', 'NO'),
    ('live_invitations', 'created_by', 'text', 'NO'), ('live_invitations', 'status', 'text', 'NO'),
    ('live_invitations', 'epoch', 'bigint', 'NO'), ('live_invitations', 'expires_at', 'timestamp with time zone', 'NO'),
    ('live_invitations', 'accepted_at', 'timestamp with time zone', 'YES'),
    ('live_invitations', 'revoked_at', 'timestamp with time zone', 'YES'),
    ('live_invitations', 'created_at', 'timestamp with time zone', 'NO'), ('live_invitations', 'row_version', 'bigint', 'NO'),
    ('live_invitation_epochs', 'storage_scope_id', 'text', 'NO'), ('live_invitation_epochs', 'artifact_id', 'uuid', 'NO'),
    ('live_invitation_epochs', 'binding_generation', 'bigint', 'NO'),
    ('live_invitation_epochs', 'live_session_id', 'uuid', 'NO'), ('live_invitation_epochs', 'epoch', 'bigint', 'NO')
  ), actual AS (
    SELECT c.table_name::text AS table_name, c.column_name::text AS column_name, c.data_type::text AS data_type,
      c.is_nullable::text AS is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'artifacts' AND c.table_name IN ('live_invitations', 'live_invitation_epochs')
  )
  SELECT string_agg(coalesce(e.table_name, a.table_name) || '.' || coalesce(e.column_name, a.column_name), ', ') INTO drift
  FROM expected e FULL JOIN actual a ON a.table_name = e.table_name AND a.column_name = e.column_name
    AND a.data_type = e.data_type AND a.is_nullable = e.is_nullable
  WHERE e.table_name IS NULL OR a.table_name IS NULL;
  IF drift IS NOT NULL THEN
    RAISE EXCEPTION 'live invitations schema mismatch (columns): %', drift;
  END IF;
  WITH expected (table_name, index_name, is_unique, is_partial, key_columns) AS (VALUES
    ('live_invitations', 'live_invitations_pkey', true, false, 'invitation_id'),
    ('live_invitations', 'live_invitations_session_idx', false, false,
      'storage_scope_id,artifact_id,binding_generation,live_session_id'),
    ('live_invitations', 'live_invitations_open_principal_uq', true, true,
      'storage_scope_id,artifact_id,binding_generation,live_session_id,principal_id'),
    ('live_invitation_epochs', 'live_invitation_epochs_pkey', true, false,
      'storage_scope_id,artifact_id,binding_generation,live_session_id')
  ), actual AS (
    SELECT p.tablename::text AS table_name, p.indexname::text AS index_name, x.indisunique AS is_unique,
      x.indpred IS NOT NULL AS is_partial,
      (SELECT string_agg(att.attname::text, ',' ORDER BY k.ord)
        FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute att ON att.attrelid = x.indrelid AND att.attnum = k.attnum) AS key_columns
    FROM pg_indexes p
    JOIN pg_class i ON i.relname = p.indexname AND i.relnamespace = 'artifacts'::regnamespace
    JOIN pg_index x ON x.indexrelid = i.oid
    WHERE p.schemaname = 'artifacts' AND p.tablename IN ('live_invitations', 'live_invitation_epochs')
  )
  SELECT string_agg(coalesce(e.table_name, a.table_name) || '.' || coalesce(e.index_name, a.index_name), ', ') INTO drift
  FROM expected e FULL JOIN actual a ON a.table_name = e.table_name AND a.index_name = e.index_name
    AND a.is_unique = e.is_unique AND a.is_partial = e.is_partial AND a.key_columns = e.key_columns
  WHERE e.index_name IS NULL OR a.index_name IS NULL;
  IF drift IS NOT NULL THEN
    RAISE EXCEPTION 'live invitations schema mismatch (indexes): %', drift;
  END IF;
END
$$;
