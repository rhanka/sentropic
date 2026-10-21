-- UPDATE row triggers see the latest locked tuple, including for stale SQL.
-- Read denial remains independent in 0018; no ratified migration is changed.
CREATE FUNCTION "control"."session_content_preserve_capture_denial"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'revoked' OR (OLD.state <> 'active' AND NEW.state = 'active') THEN
    IF NEW.state <> 'revoked' THEN
      NEW.state := OLD.state;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'session_content_grants' THEN
    NEW.local_deny_pending := NEW.local_deny_pending
      OR (OLD.local_deny_pending AND NEW.state <> 'revoked');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "session_content_projects_capture_floor"
BEFORE UPDATE ON "control"."session_content_projects"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_capture_denial"();
--> statement-breakpoint
CREATE TRIGGER "session_content_grants_capture_floor"
BEFORE UPDATE ON "control"."session_content_grants"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_capture_denial"();
--> statement-breakpoint
CREATE TRIGGER "session_content_history_capture_floor"
BEFORE UPDATE ON "control"."session_content_history_authorizations"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_capture_denial"();
