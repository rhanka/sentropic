#!/bin/sh
set -eu
psql -XAtq -v ON_ERROR_STOP=1 -f /sql/export-prod.sql > /work/.export.log 2>&1 || { echo 'protocol export failed'; exit 1; }
echo 'protocol leg done: consents.csv clients.csv (CM leg runs next as the api runner)'
