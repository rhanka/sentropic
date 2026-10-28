-- Decision metadata only: request content, verdicts and credentials are never persisted here.
CREATE TABLE control.decision_evaluator_state (
  evaluator_key text PRIMARY KEY,
  disabled boolean NOT NULL DEFAULT false,
  evidence jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE control.decision_calls (
  call_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_key text NOT NULL,
  evaluator_key text,
  hold_id text UNIQUE REFERENCES control.budget_holds(id),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
