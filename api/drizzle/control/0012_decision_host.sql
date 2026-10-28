-- Decision metadata only: request content, verdicts and credentials are never persisted here.
ALTER TABLE control.cost_ledger
  DROP CONSTRAINT cost_ledger_operation_check,
  ADD CONSTRAINT cost_ledger_operation_check CHECK (operation IN ('generate', 'stream', 'decision')) NOT VALID;
--> statement-breakpoint
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
--> statement-breakpoint
-- Published standard tariffs verified 2026-10-28; input tokens only, no cache or output charge.
-- JEV 1.13: https://docs.typesafe.ai/models.md ($42/Btok = $0.042/Mtok).
-- OpenAI: https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability ($0.10/Mtok).
-- Serialize with the existing model-pricing writer and close only an open predecessor.
DO $$
DECLARE price record;
BEGIN
  FOR price IN SELECT * FROM (VALUES
    ('jev-1.13.0-standard-2026-10-28', 'typesafe', 'jev-1.13.0', 42000::bigint),
    ('openai-decisions-standard-no-cache-2026-10-26', 'openai', 'gpt-6-luna', 100000::bigint)
  ) AS prices(id, provider_id, model_id, input_rate)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(price.provider_id), hashtext(price.model_id));
    UPDATE control.model_pricing SET effective_to = '2026-10-28T00:00:00Z'
      WHERE provider_id = price.provider_id AND model_id = price.model_id
        AND effective_to IS NULL AND effective_from < '2026-10-28T00:00:00Z';
    IF EXISTS (SELECT 1 FROM control.model_pricing
      WHERE provider_id = price.provider_id AND model_id = price.model_id
        AND (effective_to IS NULL OR effective_to > '2026-10-28T00:00:00Z')) THEN
      RAISE EXCEPTION 'Decision pricing window overlaps';
    END IF;
    INSERT INTO control.model_pricing
      (id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
       min_charge_micro_usd, effective_from)
      VALUES (price.id, price.provider_id, price.model_id, price.input_rate, 0, 0, '2026-10-28T00:00:00Z');
  END LOOP;
END $$;
