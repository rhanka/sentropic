-- Immutable AVL nodes: insertion copies the search path and rotations only.
CREATE FUNCTION __DATA_SCHEMA__.map_node(k text, v bytea, l bigint, r bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE lh integer := 0; rh integer := 0; ls bigint := 0; rs bigint := 0; result bigint;
BEGIN
  IF l IS NOT NULL THEN SELECT height, size INTO STRICT lh, ls FROM __DATA_SCHEMA__.map_nodes WHERE id=l; END IF;
  IF r IS NOT NULL THEN SELECT height, size INTO STRICT rh, rs FROM __DATA_SCHEMA__.map_nodes WHERE id=r; END IF;
  INSERT INTO __DATA_SCHEMA__.map_nodes(key,value,left_id,right_id,height,size)
    VALUES(k,v,l,r,1+greatest(lh,rh),1+ls+rs) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE FUNCTION __DATA_SCHEMA__.map_put(root bigint, k text, v bytea) RETURNS bigint
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE n __DATA_SCHEMA__.map_nodes; child __DATA_SCHEMA__.map_nodes; pivot __DATA_SCHEMA__.map_nodes;
  l bigint; r bigint; lh integer := 0; rh integer := 0; ah integer := 0; bh integer := 0;
BEGIN
  IF root IS NULL THEN RETURN __DATA_SCHEMA__.map_node(k,v,NULL,NULL); END IF;
  SELECT * INTO STRICT n FROM __DATA_SCHEMA__.map_nodes WHERE id=root;
  l:=n.left_id; r:=n.right_id;
  IF k COLLATE "C" < n.key COLLATE "C" THEN l:=__DATA_SCHEMA__.map_put(l,k,v);
  ELSIF k COLLATE "C" > n.key COLLATE "C" THEN r:=__DATA_SCHEMA__.map_put(r,k,v);
  ELSE
    IF v IS NOT DISTINCT FROM n.value THEN RETURN root; END IF;
    RETURN __DATA_SCHEMA__.map_node(k,v,l,r);
  END IF;
  IF l IS NOT NULL THEN SELECT height INTO STRICT lh FROM __DATA_SCHEMA__.map_nodes WHERE id=l; END IF;
  IF r IS NOT NULL THEN SELECT height INTO STRICT rh FROM __DATA_SCHEMA__.map_nodes WHERE id=r; END IF;
  IF lh-rh > 1 THEN
    SELECT * INTO STRICT child FROM __DATA_SCHEMA__.map_nodes WHERE id=l;
    IF child.left_id IS NOT NULL THEN SELECT height INTO STRICT ah FROM __DATA_SCHEMA__.map_nodes WHERE id=child.left_id; END IF;
    IF child.right_id IS NOT NULL THEN SELECT height INTO STRICT bh FROM __DATA_SCHEMA__.map_nodes WHERE id=child.right_id; END IF;
    IF ah >= bh THEN
      RETURN __DATA_SCHEMA__.map_node(child.key,child.value,child.left_id,__DATA_SCHEMA__.map_node(n.key,n.value,child.right_id,r));
    END IF;
    SELECT * INTO STRICT pivot FROM __DATA_SCHEMA__.map_nodes WHERE id=child.right_id;
    RETURN __DATA_SCHEMA__.map_node(pivot.key,pivot.value,
      __DATA_SCHEMA__.map_node(child.key,child.value,child.left_id,pivot.left_id),__DATA_SCHEMA__.map_node(n.key,n.value,pivot.right_id,r));
  ELSIF rh-lh > 1 THEN
    SELECT * INTO STRICT child FROM __DATA_SCHEMA__.map_nodes WHERE id=r;
    IF child.left_id IS NOT NULL THEN SELECT height INTO STRICT ah FROM __DATA_SCHEMA__.map_nodes WHERE id=child.left_id; END IF;
    IF child.right_id IS NOT NULL THEN SELECT height INTO STRICT bh FROM __DATA_SCHEMA__.map_nodes WHERE id=child.right_id; END IF;
    IF bh >= ah THEN
      RETURN __DATA_SCHEMA__.map_node(child.key,child.value,__DATA_SCHEMA__.map_node(n.key,n.value,l,child.left_id),child.right_id);
    END IF;
    SELECT * INTO STRICT pivot FROM __DATA_SCHEMA__.map_nodes WHERE id=child.left_id;
    RETURN __DATA_SCHEMA__.map_node(pivot.key,pivot.value,
      __DATA_SCHEMA__.map_node(n.key,n.value,l,pivot.left_id),__DATA_SCHEMA__.map_node(child.key,child.value,pivot.right_id,child.right_id));
  END IF;
  RETURN __DATA_SCHEMA__.map_node(n.key,n.value,l,r);
END $$;
CREATE FUNCTION __DATA_SCHEMA__.map_get(root bigint, k text) RETURNS bytea
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE n __DATA_SCHEMA__.map_nodes;
BEGIN
  WHILE root IS NOT NULL LOOP
    SELECT * INTO STRICT n FROM __DATA_SCHEMA__.map_nodes WHERE id=root;
    IF k COLLATE "C" = n.key COLLATE "C" THEN RETURN n.value; END IF;
    IF k COLLATE "C" < n.key COLLATE "C" THEN root:=n.left_id; ELSE root:=n.right_id; END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE FUNCTION __DATA_SCHEMA__.map_at(root bigint, ordinal_position bigint) RETURNS TABLE(key text,value bytea)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE n __DATA_SCHEMA__.map_nodes; left_size bigint;
BEGIN
  IF ordinal_position < 0 THEN RETURN; END IF;
  WHILE root IS NOT NULL LOOP
    SELECT * INTO STRICT n FROM __DATA_SCHEMA__.map_nodes WHERE id=root;
    left_size:=0;
    IF n.left_id IS NOT NULL THEN SELECT size INTO STRICT left_size FROM __DATA_SCHEMA__.map_nodes WHERE id=n.left_id; END IF;
    IF ordinal_position=left_size THEN key:=n.key; value:=n.value; RETURN NEXT; RETURN;
    ELSIF ordinal_position<left_size THEN root:=n.left_id;
    ELSE ordinal_position:=ordinal_position-left_size-1; root:=n.right_id; END IF;
  END LOOP;
END $$;
CREATE FUNCTION __DATA_SCHEMA__.map_page(root bigint, ordinal_position bigint, page_size integer) RETURNS TABLE(key text,value bytea)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF page_size < 1 OR page_size > 1024 THEN RAISE EXCEPTION 'invalid map page size' USING ERRCODE='22023'; END IF;
  FOR offset_value IN 0..page_size-1 LOOP
    RETURN QUERY SELECT * FROM __DATA_SCHEMA__.map_at(root,ordinal_position+offset_value);
  END LOOP;
END $$;
