#!/bin/sh
set -eu
psql -XAtq -v ON_ERROR_STOP=1 -f /sql/export-prod.sql > /work/.export.log 2>&1 || { echo 'identity export failed'; exit 1; }
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
IFS=, read -r snapshot users credentials consents clients < snapshot.csv
echo "users=$users webauthn=$credentials consents=$consents clients=$clients"
printf '{"users":%s,"webauthn":%s,"consents":%s,"clients":%s}\n' "$users" "$credentials" "$consents" "$clients" > /dev/termination-log
