-- Canonical effective ACLs: order-independent, with implicit defaults made explicit.
-- Every entry retains grantor, grantee, privilege and grant option; identities use names, not OIDs.
WITH objects AS (
  SELECT 'schema' AS kind,nspname AS name,to_jsonb(nspowner::regrole::text) AS identity,
    coalesce(nspacl,acldefault('n',nspowner)) AS acl
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL
  SELECT 'relation',n.nspname||'.'||c.relname,jsonb_build_array(c.relkind,c.relowner::regrole::text),
    coalesce(c.relacl,CASE WHEN c.relkind='S' THEN acldefault('S',c.relowner)
      WHEN c.relkind IN ('r','v','m','f','p') THEN acldefault('r',c.relowner) ELSE '{}'::aclitem[] END)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,'null'::jsonb,coalesce(a.attacl,'{}'::aclitem[])
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    to_jsonb(p.proowner::regrole::text),coalesce(p.proacl,acldefault('f',p.proowner))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'default',r.rolname||'.'||coalesce(n.nspname,'')||'.'||d.defaclobjtype::text,
    to_jsonb(d.defaclobjtype::text),d.defaclacl
  FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
  LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
), entries AS (
  SELECT kind,name,jsonb_build_array(identity,(SELECT coalesce(jsonb_agg(jsonb_build_array(
    x.grantor::regrole::text,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END,
    x.privilege_type,x.is_grantable) ORDER BY x.grantor::regrole::text COLLATE "C",
    CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END COLLATE "C",
    x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
    FROM aclexplode(CASE WHEN cardinality(acl)>0 THEN acl ELSE NULL::aclitem[] END) x)) AS permissions
  FROM objects
)
SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(kind,name,permissions)
  ORDER BY kind COLLATE "C",name COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS acl_sha256 FROM entries;
