CREATE INDEX comments_lifecycle_evidence ON __COMMENTS_SCHEMA__.comments_headers
  (scope_key,chain_key,(links->>'action'))
  WHERE selection->>'kind'='lifecycle-events';
