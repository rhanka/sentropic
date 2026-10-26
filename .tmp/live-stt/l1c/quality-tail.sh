#!/bin/sh
# Appended after the existing cold-workspace bootstrap, inside the ENV Compose service.
set -eu
/tmp/cm-tools/node_modules/.bin/tsc -p tsconfig.json
/tmp/cm-tools/node_modules/.bin/tsc --noEmit -p tsconfig.test.json
/tmp/cm-tools/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module NodeNext --moduleResolution NodeNext tests/speech-config.spec.ts tests/speech-projection.spec.ts
npm_config_cache=/tmp/npm-cache npm install --prefix /tmp/l1c-lint --ignore-scripts \
  --no-audit --no-fund eslint@10.0.2 typescript-eslint@8.56.1 >/dev/null
cat > /tmp/l1c-lint/eslint.config.mjs <<'CONFIG'
import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, { rules: {
  '@typescript-eslint/no-empty-object-type': 'off', '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
} });
CONFIG
/tmp/l1c-lint/node_modules/.bin/eslint --config /tmp/l1c-lint/eslint.config.mjs \
  src/speech src/config.ts src/index.ts src/modules/catalog.ts \
  tests/speech-config.spec.ts tests/speech-projection.spec.ts tests/speech-fixtures.ts
npm pack --ignore-scripts --dry-run --json > /tmp/l1c-pack.json
node /source/.tmp/live-stt/l1c/public-check.mjs "$PWD" /tmp/l1c-pack.json
