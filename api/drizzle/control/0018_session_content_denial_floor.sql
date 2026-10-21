-- Row triggers run under PostgreSQL's write lock against the latest tuple,
-- including when a concurrent writer supplies a pre-revocation snapshot.
CREATE FUNCTION "control"."session_content_preserve_read_denial"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.read_denied := NEW.read_denied OR OLD.read_denied OR OLD.state = 'revoked';
  END IF;
  NEW.read_denied := NEW.read_denied OR NEW.state = 'revoked';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "session_content_projects_denial_floor"
BEFORE INSERT OR UPDATE ON "control"."session_content_projects"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_read_denial"();
--> statement-breakpoint
CREATE TRIGGER "session_content_grants_denial_floor"
BEFORE INSERT OR UPDATE ON "control"."session_content_grants"
FOR EACH ROW EXECUTE FUNCTION "control"."session_content_preserve_read_denial"();
