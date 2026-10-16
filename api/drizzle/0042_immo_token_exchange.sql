-- 2-IdP: RFC 8693 token-exchange policy on service_clients (nullable, default-deny).
-- NULL = the client cannot perform token exchange; existing client_credentials behavior
-- for all current rows is unchanged. The `immo-mcp-workload` exchange-only client carries
-- an enabled policy with `allowClientCredentials: false`. Additive, rolling-deploy safe:
-- old pods ignore the column; new pods treat NULL as disabled.
ALTER TABLE "service_clients" ADD COLUMN IF NOT EXISTS "exchange_policy" jsonb;
--> statement-breakpoint
