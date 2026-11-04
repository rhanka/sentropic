-- Baseline protocol fingerprint (helpers live in preprod.sql).
SELECT test_assert((SELECT count(*) FROM oauth_clients) = 2, 'baseline protocol clients 2');
SELECT test_assert((SELECT count(*) FROM oauth_consents) = 3, 'baseline protocol consents 3');
SELECT test_assert((SELECT count(*) FROM service_clients) = 2, 'baseline service clients 2');
SELECT test_assert((SELECT count(*) FROM id_token_signing_keys WHERE active) = 1, 'baseline DV5 keys 1');
