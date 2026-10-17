ALTER TABLE __DATA_SCHEMA__.modules ADD COLUMN descriptor_digest text;
CREATE TABLE __DATA_SCHEMA__.consumer_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope_key text NOT NULL,
  consumer text NOT NULL, operation text NOT NULL, owner text NOT NULL,
  event_id text, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consumer_actions_scope ON __DATA_SCHEMA__.consumer_actions(scope_key,consumer,id);
CREATE FUNCTION __DATA_SCHEMA__.map_lower_bound(root bigint, lower_key text) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE n __DATA_SCHEMA__.map_nodes; result bigint := 0; left_size bigint;
BEGIN
  WHILE root IS NOT NULL LOOP
    SELECT * INTO STRICT n FROM __DATA_SCHEMA__.map_nodes WHERE id=root;
    left_size:=0;
    IF n.left_id IS NOT NULL THEN SELECT size INTO STRICT left_size FROM __DATA_SCHEMA__.map_nodes WHERE id=n.left_id; END IF;
    IF n.key COLLATE "C" < lower_key COLLATE "C" THEN result:=result+left_size+1; root:=n.right_id;
    ELSE root:=n.left_id; END IF;
  END LOOP;
  RETURN result;
END $$;
