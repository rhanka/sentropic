#!/bin/sh
# Run inside the prepared package workspace; both backends must be available.
set -eu
if [ -z "${CM_PG_URL:-}" ]; then
  echo 'Identity qualification requires PostgreSQL; no profile may be omitted' >&2
  exit 1
fi
receipt_dir=${CM_IDENTITY_RECEIPTS:-/source/tmp/identity-qualification}
mkdir -p "$receipt_dir"
status=0
for profile in sqlite postgres; do
  /tmp/cm-tools/node_modules/.bin/vitest run \
    --config "tests/identity/vitest.$profile.config.ts" --environment node --maxWorkers=1 \
    --reporter=default --reporter=json --outputFile="$receipt_dir/$profile.json" || status=1
  node --input-type=module - "$receipt_dir/$profile.json" <<'JS' || status=1
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const required = ['a20b-prerequisites', 'custody-contract', 'custody-storage', 'custody-import',
  'custody-concurrency', 'atomic-person-deletion', 'auth-binding', 'remote-delivery',
  'connector-custody', 'custody-security'];
for (const spec of required) {
  if (!result.testResults.some((file) => file.name.endsWith(`/tests/identity/${spec}.spec.ts`) && file.assertionResults.length > 0)) {
    throw new Error(`Required identity spec was not executed: ${spec}`);
  }
}
if (!result.success || result.numPendingTests !== 0 || result.numTodoTests !== 0 || result.numTotalTests === 0) {
  throw new Error('Identity qualification requires passing, executed tests with zero skips or todo cases');
}
JS
done
exit "$status"
