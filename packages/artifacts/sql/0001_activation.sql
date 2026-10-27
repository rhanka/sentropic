-- UP-T v1. Host migration executor owns serialization, transaction and journal.
-- Independent of the publication schema. Never run DDL on adapter construction.
CREATE SCHEMA IF NOT EXISTS artifact_host;

CREATE TABLE artifact_host.activation_namespaces (
  namespace text PRIMARY KEY CHECK (length(namespace) BETWEEN 1 AND 256),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0)
);

CREATE TABLE artifact_host.activation_tickets (
  namespace text NOT NULL REFERENCES artifact_host.activation_namespaces(namespace),
  generation bigint NOT NULL,
  payload jsonb NOT NULL,
  ticket_id text GENERATED ALWAYS AS (payload->>'ticketId') STORED NOT NULL,
  subject_id text GENERATED ALWAYS AS (payload->>'subjectId') STORED NOT NULL,
  artifact_id text GENERATED ALWAYS AS (payload->>'artifactId') STORED NOT NULL,
  release_id text GENERATED ALWAYS AS (payload->>'releaseId') STORED NOT NULL,
  channel text GENERATED ALWAYS AS (payload->>'channel') STORED NOT NULL,
  expires_ms bigint GENERATED ALWAYS AS ((payload->>'expiresAt')::bigint) STORED NOT NULL,
  issued_ms bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()) * 1000),
  PRIMARY KEY (namespace, ticket_id),
  UNIQUE (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, expires_ms),
  CHECK (length(ticket_id) BETWEEN 1 AND 256 AND length(subject_id) BETWEEN 1 AND 256),
  CHECK (length(artifact_id) BETWEEN 1 AND 256 AND length(release_id) BETWEEN 1 AND 256),
  CHECK (channel IN ('stable', 'pinned')),
  CHECK (jsonb_typeof(payload->'expiresAt') = 'number'),
  CHECK (expires_ms > issued_ms AND expires_ms <= issued_ms + 60000)
);
CREATE INDEX activation_tickets_expiry ON artifact_host.activation_tickets(namespace, expires_ms, ticket_id);
CREATE INDEX activation_tickets_generation ON artifact_host.activation_tickets(namespace, generation, ticket_id);

CREATE TABLE artifact_host.browser_flows (
  namespace text NOT NULL,
  generation bigint NOT NULL,
  payload jsonb NOT NULL,
  flow_id text GENERATED ALWAYS AS (payload->>'flowId') STORED NOT NULL,
  ticket_id text GENERATED ALWAYS AS (payload->>'ticketId') STORED NOT NULL,
  subject_id text GENERATED ALWAYS AS (payload->>'subjectId') STORED NOT NULL,
  artifact_id text GENERATED ALWAYS AS (payload->>'artifactId') STORED NOT NULL,
  release_id text GENERATED ALWAYS AS (payload->>'releaseId') STORED NOT NULL,
  channel text GENERATED ALWAYS AS (payload->>'channel') STORED NOT NULL,
  expires_ms bigint GENERATED ALWAYS AS ((payload->>'expiresAt')::bigint) STORED NOT NULL,
  ticket_expires_ms bigint NOT NULL,
  PRIMARY KEY (namespace, flow_id),
  UNIQUE (namespace, ticket_id),
  FOREIGN KEY (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, ticket_expires_ms)
    REFERENCES artifact_host.activation_tickets
      (namespace, generation, ticket_id, subject_id, artifact_id, release_id, channel, expires_ms)
    ON DELETE CASCADE,
  CHECK (length(flow_id) BETWEEN 1 AND 256),
  CHECK (expires_ms <= ticket_expires_ms),
  CHECK (jsonb_typeof(payload->'expiresAt') = 'number'),
  CHECK (length(payload->>'sessionId') BETWEEN 1 AND 256 AND payload->>'sessionId' IS NOT NULL),
  CHECK (length(payload->>'policyRevision') BETWEEN 1 AND 256 AND payload->>'policyRevision' IS NOT NULL),
  CHECK (payload->>'nonceDigest' ~ '^[0-9a-f]{64}$' AND payload->>'nonceDigest' IS NOT NULL),
  CHECK (payload->>'profileDigest' ~ '^[0-9a-f]{64}$' AND payload->>'profileDigest' IS NOT NULL),
  CHECK (payload->>'targetOrigin' ~ '^https://[^/]+$' AND payload->>'targetOrigin' IS NOT NULL)
);
CREATE INDEX browser_flows_expiry ON artifact_host.browser_flows(namespace, expires_ms, flow_id);
CREATE INDEX browser_flows_generation ON artifact_host.browser_flows(namespace, generation, flow_id);

CREATE FUNCTION artifact_host.activation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activation records are immutable' USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER activation_tickets_immutable BEFORE UPDATE ON artifact_host.activation_tickets
  FOR EACH ROW EXECUTE FUNCTION artifact_host.activation_immutable();
CREATE TRIGGER browser_flows_immutable BEFORE UPDATE ON artifact_host.browser_flows
  FOR EACH ROW EXECUTE FUNCTION artifact_host.activation_immutable();
