-- pg_dump can omit initdb's public schema owner/ACL; capture the catalogue explicitly.
SELECT pg_catalog.format('ALTER SCHEMA public OWNER TO %I;',pg_catalog.pg_get_userbyid(nspowner))
FROM pg_catalog.pg_namespace WHERE nspname OPERATOR(pg_catalog.=) 'public';
SELECT 'REVOKE ALL ON SCHEMA public FROM PUBLIC;';
SELECT pg_catalog.format('GRANT %s ON SCHEMA public TO %s%s;',x.privilege_type,
  CASE WHEN x.grantee OPERATOR(pg_catalog.=) 0::pg_catalog.oid THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(x.grantee)) END,
  CASE WHEN x.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) x
WHERE n.nspname OPERATOR(pg_catalog.=) 'public'
ORDER BY x.grantee USING OPERATOR(pg_catalog.>),x.privilege_type COLLATE pg_catalog."C" USING OPERATOR(pg_catalog.<);
