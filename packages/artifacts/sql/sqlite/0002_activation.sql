-- U1 — SQLite DDL for the activation host domain, owned by the SQLite
-- adapter. The Postgres `artifact_host.<table>` names map to plain
-- `<table>` (SQLite has no schemas); bigint -> INTEGER, jsonb -> TEXT,
-- generated columns use json_extract, and the regex CHECKs of
-- sql/0001_activation.sql are enforced in adapter code (SQLite has no
-- REGEXP without a host function). Immutability triggers are kept.
-- DB time is CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) ms.

CREATE TABLE IF NOT EXISTS activation_namespaces (
  namespace TEXT PRIMARY KEY CHECK (length(namespace) BETWEEN 1 AND 256),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0)
);

CREATE TABLE IF NOT EXISTS activation_tickets (
  namespace TEXT NOT NULL REFERENCES activation_namespaces (namespace),
  generation INTEGER NOT NULL,
  payload TEXT NOT NULL,
  ticket_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.ticketId')) STORED NOT NULL,
  subject_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.subjectId')) STORED NOT NULL,
  artifact_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.artifactId')) STORED NOT NULL,
  release_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.releaseId')) STORED NOT NULL,
  channel TEXT GENERATED ALWAYS AS (json_extract(payload, '$.channel')) STORED NOT NULL,
  expires_ms INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.expiresAt')) STORED NOT NULL,
  issued_ms INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  -- SQLite forbids generated columns in a PRIMARY KEY; UNIQUE (which creates
  -- the index the FK and lookups need) accepts them.
  UNIQUE (namespace, ticket_id),
  UNIQUE (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, expires_ms),
  CHECK (length(ticket_id) BETWEEN 1 AND 256 AND length(subject_id) BETWEEN 1 AND 256),
  CHECK (length(artifact_id) BETWEEN 1 AND 256 AND length(release_id) BETWEEN 1 AND 256),
  CHECK (channel IN ('stable', 'pinned')),
  -- pg jsonb_typeof = 'number' covers all numbers; SQLite splits integer/real.
  CHECK (json_type(payload, '$.expiresAt') IN ('integer', 'real')),
  CHECK (expires_ms > issued_ms AND expires_ms <= issued_ms + 60000)
);
CREATE INDEX IF NOT EXISTS activation_tickets_expiry ON activation_tickets (namespace, expires_ms, ticket_id);
CREATE INDEX IF NOT EXISTS activation_tickets_generation ON activation_tickets (namespace, generation, ticket_id);

CREATE TABLE IF NOT EXISTS browser_flows (
  namespace TEXT NOT NULL,
  generation INTEGER NOT NULL,
  payload TEXT NOT NULL,
  flow_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.flowId')) STORED NOT NULL,
  ticket_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.ticketId')) STORED NOT NULL,
  subject_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.subjectId')) STORED NOT NULL,
  artifact_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.artifactId')) STORED NOT NULL,
  release_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.releaseId')) STORED NOT NULL,
  channel TEXT GENERATED ALWAYS AS (json_extract(payload, '$.channel')) STORED NOT NULL,
  expires_ms INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.expiresAt')) STORED NOT NULL,
  ticket_expires_ms INTEGER NOT NULL,
  UNIQUE (namespace, flow_id),
  UNIQUE (namespace, ticket_id),
  FOREIGN KEY (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, ticket_expires_ms)
    REFERENCES activation_tickets
      (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, expires_ms)
    ON DELETE CASCADE,
  CHECK (length(flow_id) BETWEEN 1 AND 256),
  CHECK (expires_ms <= ticket_expires_ms),
  CHECK (json_type(payload, '$.expiresAt') IN ('integer', 'real')),
  CHECK (length(json_extract(payload, '$.sessionId')) BETWEEN 1 AND 256 AND json_extract(payload, '$.sessionId') IS NOT NULL),
  CHECK (length(json_extract(payload, '$.policyRevision')) BETWEEN 1 AND 256 AND json_extract(payload, '$.policyRevision') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS browser_flows_expiry ON browser_flows (namespace, expires_ms, flow_id);
CREATE INDEX IF NOT EXISTS browser_flows_generation ON browser_flows (namespace, generation, flow_id);

CREATE TRIGGER IF NOT EXISTS activation_tickets_immutable BEFORE UPDATE ON activation_tickets
BEGIN
  SELECT RAISE(ABORT, 'activation records are immutable');
END;
CREATE TRIGGER IF NOT EXISTS browser_flows_immutable BEFORE UPDATE ON browser_flows
BEGIN
  SELECT RAISE(ABORT, 'activation records are immutable');
END;
