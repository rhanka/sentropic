-- pg_dump can omit initdb's public schema owner/ACL; capture the catalogue explicitly.
SELECT format('ALTER SCHEMA public OWNER TO %I;',pg_get_userbyid(nspowner))
FROM pg_namespace WHERE nspname='public';
SELECT 'REVOKE ALL ON SCHEMA public FROM PUBLIC;';
SELECT format('GRANT %s ON SCHEMA public TO %s%s;',x.privilege_type,
  CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END,
  CASE WHEN x.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x
WHERE n.nspname='public' ORDER BY x.grantee DESC,x.privilege_type;
