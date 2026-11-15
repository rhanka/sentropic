-- Canonical effective ACLs: order-independent, with implicit defaults made explicit.
-- Every entry retains grantor, grantee, privilege and grant option; identities use names, not OIDs.
-- Search-path independent: every relation, function, type, collation and operator is
-- pg_catalog-qualified, and a function signature names each argument type as schema.type read
-- from pg_type. pg_get_function_identity_arguments follows the session search_path, which pg_dump
-- empties for the whole restore session: pg_trgm's public.gtrgm then changed the hash (rehearsal r9).
WITH objects AS (
  SELECT 'schema'::pg_catalog.text AS kind,n.nspname::pg_catalog.text AS name,
    pg_catalog.to_jsonb(n.nspowner::pg_catalog.regrole::pg_catalog.text) AS identity,
    coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner)) AS acl
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'
  UNION ALL
  SELECT 'relation',n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname,
    pg_catalog.jsonb_build_array(c.relkind,c.relowner::pg_catalog.regrole::pg_catalog.text),
    coalesce(c.relacl,CASE WHEN c.relkind OPERATOR(pg_catalog.=) 'S' THEN pg_catalog.acldefault('S',c.relowner)
      WHEN c.relkind OPERATOR(pg_catalog.=) ANY (ARRAY['r','v','m','f','p']::pg_catalog."char"[])
        THEN pg_catalog.acldefault('r',c.relowner) ELSE '{}'::pg_catalog.aclitem[] END)
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
  WHERE n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'
  UNION ALL
  SELECT 'column',n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname
      OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) a.attname,
    'null'::pg_catalog.jsonb,coalesce(a.attacl,'{}'::pg_catalog.aclitem[])
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
  WHERE a.attnum OPERATOR(pg_catalog.>) 0 AND NOT a.attisdropped
    AND n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'
  UNION ALL
  SELECT 'function',n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname
      OPERATOR(pg_catalog.||) '(' OPERATOR(pg_catalog.||) coalesce((
        SELECT pg_catalog.string_agg(tn.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) t.typname,
          ', ' ORDER BY arg.position)
        FROM pg_catalog.unnest(p.proargtypes::pg_catalog.oid[]) WITH ORDINALITY AS arg(type_oid,position)
        JOIN pg_catalog.pg_type t ON t.oid OPERATOR(pg_catalog.=) arg.type_oid
        JOIN pg_catalog.pg_namespace tn ON tn.oid OPERATOR(pg_catalog.=) t.typnamespace),'')
      OPERATOR(pg_catalog.||) ')',
    pg_catalog.to_jsonb(p.proowner::pg_catalog.regrole::pg_catalog.text),
    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) p.pronamespace
  WHERE n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'
  UNION ALL
  SELECT 'default',r.rolname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) coalesce(n.nspname,'')
      OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) d.defaclobjtype::pg_catalog.text,
    pg_catalog.to_jsonb(d.defaclobjtype::pg_catalog.text),d.defaclacl
  FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid OPERATOR(pg_catalog.=) d.defaclrole
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) d.defaclnamespace
), entries AS (
  SELECT kind,name,pg_catalog.jsonb_build_array(identity,(SELECT coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(x.grantor::pg_catalog.regrole::pg_catalog.text,
      CASE WHEN x.grantee OPERATOR(pg_catalog.=) 0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::pg_catalog.text END,
      x.privilege_type,x.is_grantable)
    ORDER BY x.grantor::pg_catalog.regrole::pg_catalog.text COLLATE pg_catalog."C",
      CASE WHEN x.grantee OPERATOR(pg_catalog.=) 0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::pg_catalog.text END
        COLLATE pg_catalog."C",
      x.privilege_type COLLATE pg_catalog."C",x.is_grantable),'[]'::pg_catalog.jsonb)
    FROM pg_catalog.aclexplode(CASE WHEN pg_catalog.cardinality(acl) OPERATOR(pg_catalog.>) 0 THEN acl
      ELSE NULL::pg_catalog.aclitem[] END) x)) AS permissions
  FROM objects
)
SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_array(kind,name,permissions)
  ORDER BY kind COLLATE pg_catalog."C",name COLLATE pg_catalog."C"),'[]'::pg_catalog.jsonb)::pg_catalog.text,'UTF8')),'hex')
  AS acl_sha256 FROM entries;
