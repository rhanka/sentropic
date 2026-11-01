-- RC2.store policy admission/cursor/outbox/purge tables (contract §10, fail-closed on source-gaps).
CREATE TABLE control.session_content_policy_admissions (
  policy_id text PRIMARY KEY,
  policy_revision integer NOT NULL CHECK (policy_revision >= 1),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('share', 'amend')),
  source_binding_digest text NOT NULL CHECK (source_binding_digest ~ '^[0-9a-f]{64}$'),
  first_admission_expires_at timestamp,
  denial_floor integer NOT NULL DEFAULT 0,
  capture_eligible boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (policy_id, policy_revision)
);
--> statement-breakpoint
CREATE TABLE control.session_content_policy_activations (
  policy_id text NOT NULL REFERENCES control.session_content_policy_admissions(policy_id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  ack_digest text NOT NULL CHECK (ack_digest ~ '^[0-9a-f]{64}$'),
  authority_revision integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, operation_id)
);
--> statement-breakpoint
CREATE TABLE control.session_content_policy_purges (
  policy_id text NOT NULL REFERENCES control.session_content_policy_admissions(policy_id) ON DELETE CASCADE,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'purge_pending' CHECK (status IN ('purge_pending', 'purged')),
  initiated_while_disconnected boolean NOT NULL DEFAULT false,
  settled_by text,
  settled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, scope),
  CHECK ((status = 'purged') = (settled_by IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX session_content_policy_activations_policy_idx ON control.session_content_policy_activations(policy_id);
CREATE INDEX session_content_policy_purges_status_idx ON control.session_content_policy_purges(status);
