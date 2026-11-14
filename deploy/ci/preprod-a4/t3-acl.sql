-- Stable names and signatures, never OIDs (which change on logical restore).
WITH entries AS (
  SELECT 'schema' AS kind, nspname AS name,
    jsonb_build_array(nspowner::regrole::text,nspacl::text) AS permissions
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL
  SELECT 'relation', n.nspname||'.'||c.relname,
    jsonb_build_array(c.relkind,c.relowner::regrole::text,c.relacl::text)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'column', n.nspname||'.'||c.relname||'.'||a.attname, to_jsonb(a.attacl::text)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_array(p.proowner::regrole::text,p.proacl::text)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'default', r.rolname||'.'||coalesce(n.nspname,'')||'.'||d.defaclobjtype::text,
    to_jsonb(d.defaclacl::text)
  FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
  LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
)
SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(kind,name,permissions)
  ORDER BY kind COLLATE "C",name COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS acl_sha256 FROM entries;
