CREATE INDEX comments_review_evidence ON __COMMENTS_SCHEMA__.comments_headers
  (scope_key,chain_key,(links->>'revisionHash'),((links->>'sequence')::bigint))
  WHERE selection->>'kind'='review-events';
CREATE INDEX comments_review_references ON __COMMENTS_SCHEMA__.comments_headers
  (scope_key,chain_key,(links->>'referencesEventHash'),(links->>'action'))
  WHERE selection->>'kind'='review-events';
