-- BR-39l Lot 2: RFC 8707 resource-indicator allowlist on the authorization_code flow.
-- Additive, default-deny: '{}' = no resource permitted (any requested resource ⇒ invalid_target).
-- Existing clients (no resource param) keep aud = userinfo URL, byte-identical to auth-hono 0.5.0.
ALTER TABLE "oauth_clients" ADD COLUMN IF NOT EXISTS "resource_indicators" text[] DEFAULT '{}' NOT NULL;
