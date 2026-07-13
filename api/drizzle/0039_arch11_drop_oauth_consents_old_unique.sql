-- ARCH-11 G1c — drop the pre-tenant `oauth_consents` unique index (spec §4.1.4, §4.3).
-- G1a (0038) DELIBERATELY KEPT the old `(user_id, client_id)` unique index alongside the new
-- composite `(user_id, client_id, tenant_id)` one, to stay rolling-deploy-safe: OLD pods still ran
-- `ON CONFLICT (user_id, client_id)`. G1a's own note assigns the DROP to G1c — "which is when
-- multi-org consent, and thus the cross-tenant bypass, actually opens".
--
-- By G1c ALL adapters target the composite index `(user_id, client_id, tenant_id)` (the shadow
-- adapter omits tenant_id → DEFAULT 'sentropic' but STILL targets the composite), so the old 2-col
-- unique is now only an OBSTACLE: it forbids a second (org-B) consent row for the same
-- (user, client). Dropping it is the step that lets per-tenant consent rows coexist (§1.5 fix).
-- Rolling-safe: `DROP INDEX IF EXISTS` is idempotent; both shadow and strict pods keep working
-- against the surviving composite unique index.

DROP INDEX IF EXISTS "oauth_consents_user_id_client_id_unique";
