-- UPDATE row triggers see the latest locked tuple, including for stale SQL.
-- Read denial remains independent in 0018; no ratified migration is changed.
CREATE OR REPLACE FUNCTION "control"."session_content_preserve_capture_denial"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Serialize admission with parent denial, including new children that
    -- were absent from a concurrent revocation's grant scan.
    SELECT * INTO parent FROM "control"."session_content_projects"
    WHERE project_id = NEW.project_id FOR SHARE;
    IF NOT FOUND OR parent.state <> 'active' OR parent.requires_fresh_amendment
      OR parent.excluded_session_ids ? NEW.session_id OR parent.project_revision <> NEW.project_revision THEN
      RAISE EXCEPTION 'session content capture denied' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'revoked' OR (OLD.state <> 'active' AND NEW.state = 'active') THEN
    IF NEW.state <> 'revoked' THEN
      NEW.state := OLD.state;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'session_content_grants' THEN
    NEW.local_deny_pending := NEW.local_deny_pending
      OR (OLD.local_deny_pending AND NEW.state <> 'revoked');
  ELSIF TG_TABLE_NAME = 'session_content_projects' THEN
    -- Removing an exclusion requires an advancing clear operation, which
    -- itself suppresses capture until a confirmed policy amendment.
    IF NOT (NEW.requires_fresh_amendment AND NEW.exclusion_revision > OLD.exclusion_revision) THEN
      SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      INTO NEW.excluded_session_ids
      FROM (SELECT DISTINCT value FROM jsonb_array_elements(OLD.excluded_session_ids || NEW.excluded_session_ids)) ids;
    END IF;
    IF NEW.project_revision <= OLD.project_revision OR NEW.exclusion_revision <> OLD.exclusion_revision THEN
      NEW.requires_fresh_amendment := OLD.requires_fresh_amendment OR NEW.requires_fresh_amendment;
    END IF;
    NEW.exclusion_revision := GREATEST(OLD.exclusion_revision, NEW.exclusion_revision);
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
BEFORE INSERT OR UPDATE ON "control"."session_content_grants"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_capture_denial"();
--> statement-breakpoint
CREATE TRIGGER "session_content_history_capture_floor"
BEFORE UPDATE ON "control"."session_content_history_authorizations"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_capture_denial"();
