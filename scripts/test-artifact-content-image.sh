#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p .tmp
scratch=$(mktemp -d .tmp/content-image.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

content_hash() {
  local inputs input probe="$scratch/hash" before changed restored
  inputs=$(sed -n 's/^export API_VERSION[[:space:]]*?=.*echo "\([^"]*\)".*/\1/p' Makefile)
  grep -Fxq apps/artifact-content <<< "${inputs// /$'\n'}" || fail 'content sources are absent from API_VERSION'
  mkdir -p "$probe/apps"
  # Use the actual Make hash expression with isolated content bytes; never edit the worktree sources.
  grep '^export API_VERSION ' Makefile > "$probe/Makefile"
  printf 'version:\n\t@echo $(API_VERSION)\n' >> "$probe/Makefile"
  for input in $inputs; do
    [ "$input" = apps/artifact-content ] && continue
    mkdir -p "$probe/$(dirname "$input")"
    ln -s "$PWD/$input" "$probe/$input"
  done
  cp -R apps/artifact-content "$probe/apps/"
  hash_version() { env -u API_VERSION make -s -C "$probe" version ENV="${ENV:?}"; }
  before=$(hash_version)
  printf '\n// isolated content-only hash witness\n' >> "$probe/apps/artifact-content/src/index.ts"
  changed=$(hash_version)
  [ "$before" != "$changed" ] || fail 'content-only edit did not invalidate the canonical tag'
  cp apps/artifact-content/src/index.ts "$probe/apps/artifact-content/src/index.ts"
  restored=$(hash_version)
  [ "$before" = "$restored" ] || fail 'restoring content did not restore the canonical tag'
  mkdir -p "$probe/apps/artifact-content/dist"
  printf 'stale generated bundle' > "$probe/apps/artifact-content/dist/index.js"
  [ "$before" = "$(hash_version)" ] || fail 'generated content bundle perturbs the source hash'
  grep -Fxq 'apps/artifact-content/dist/' .dockerignore || fail 'generated content bundle enters the build context'
  echo 'PASS: content-only edits invalidate the canonical image; generated bundles do not'
}

content_filters() {
  awk '/^            api:$/ { api=1; next } api && /^            [a-z_]+:/ { exit } api { print }' \
    .github/workflows/ci.yml | grep -Fq "'apps/artifact-content/**'" || fail 'content-only edit does not trigger the API CI lane'
  grep -Fq "'scripts/test-artifact-content-image.sh'" .github/workflows/ci.yml || fail 'content-image test edits do not trigger CI'
  echo 'PASS: content-only and test-only changes trigger canonical image qualification'
}

content_build() {
  grep -Fxq 'COPY apps/artifact-content ./apps/artifact-content' api/Dockerfile || fail 'content sources are not copied for compilation'
  grep -Fq 'npx esbuild ../apps/artifact-content/src/index.ts' api/Dockerfile || fail 'real content entrypoint is not compiled'
  grep -Fq -- '--outfile=../apps/artifact-content/dist/index.js' api/Dockerfile || fail 'compiled content entrypoint has no runtime output'
  grep -Fxq 'COPY --from=build /workspace/apps/artifact-content/dist /workspace/apps/artifact-content/dist' api/Dockerfile || fail 'production stage does not retain content bundle'
  echo 'PASS: canonical Dockerfile compiles and retains the content entrypoint'
}

content_ci_identity() {
  local build_job publish_job test_line save_line
  # Read the whole job, stopping at the next job rather than at nested steps.
  build_job=$(awk '/^  build-api-image:$/ { found=1; next } found && /^  [a-z].*:$/ { exit } found { print }' .github/workflows/ci.yml)
  test_line=$(grep -n 'run: make test-artifact-content-image .*ENV=test-ci-api' <<< "$build_job" | cut -d: -f1 || true)
  save_line=$(grep -n 'run: make save-api' <<< "$build_job" | cut -d: -f1)
  [ -n "$test_line" ] && [ -n "$save_line" ] && [ "$test_line" -lt "$save_line" ] || fail 'CI does not qualify content before transporting the canonical image'
  publish_job=$(awk '/^  publish-api-image:$/ { found=1; next } found && /^  [a-z].*:$/ { exit } found { print }' .github/workflows/ci.yml)
  grep -Fq 'name: api-image' <<< "$publish_job" || fail 'publisher does not consume the tested image artifact'
  grep -Fq 'make load-api' <<< "$publish_job" || fail 'publisher does not verify the transported image receipt'
  ! grep -Eq 'make (build-api|build-api-image)' <<< "$publish_job" || fail 'publisher rebuilds the tested artifact'
  grep -Fq '$(API_IMAGE_NAME):$(API_VERSION)' Makefile || fail 'promotion does not retain the canonical API tag'
  echo 'PASS: CI tests content before transport, publishes the verified receipt without rebuilding and retains canonical promotion tags'
}

content_runtime() {
  make --no-print-directory verify-api-image ENV="${ENV:?}"
  # Run the recorded production artifact, with no source mounts, ports or service dependencies.
  API_IMAGE_REF=$(cat "${API_IMAGE_RECEIPT:-.tmp/ci-prod-image/api-image-id}") \
    docker compose -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.ci.yml \
    run --rm --no-deps -T --entrypoint sh api-sut -ec '
      ! command -v npm && ! command -v npx && test ! -e /workspace/node_modules/.bin/tsx
      test -f /workspace/apps/artifact-content/dist/index.js
      env -i PATH="$PATH" NODE_ENV=production node --input-type=module
    ' <<'NODE'
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
const entry = '/workspace/apps/artifact-content/dist/index.js';
const env = { NODE_ENV: 'production', ARTIFACT_CONTENT_PORT: '8791' };
const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', bytes => { output += bytes; });
child.stderr.on('data', bytes => { output += bytes; });
const exit = once(child, 'exit');
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, `content entrypoint exited: ${output}`);
    try { health = await fetch('http://127.0.0.1:8791/healthz'); break; }
    catch { await delay(25); }
  }
  assert.equal(health?.status, 200, `content entrypoint did not listen: ${output}`);
  assert.equal(await health.text(), 'ok');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  for (const path of ['/', '/_reader/activate', '/artifacts/private/blobs/sha256/secret']) {
    const response = await fetch(`http://127.0.0.1:8791${path}`, {
      headers: { 'x-forwarded-host': 'forged.content.example.test', 'x-subject-id': 'forged' },
    });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  const [code, signal] = await exit;
  clearTimeout(timer);
  assert.equal(code, 0, output);
  assert.equal(signal, null);
} finally { if (child.exitCode === null) child.kill('SIGKILL'); }
const refused = spawnSync(process.execPath, [entry], {
  env: { ...env, APP_ARTIFACT_CONTENT_ENABLED: '1' }, encoding: 'utf8', timeout: 3000,
});
assert.equal(refused.status, 1);
assert.match(refused.stderr, /Artifact content startup refused/);
console.log('PASS: real pruned content entrypoint serves health, denies private reads, shuts down and refuses incomplete activation');
NODE
}

case "${1:-static}" in
  hash) content_hash ;;
  filters) content_filters ;;
  build) content_build ;;
  identity) content_ci_identity ;;
  static) content_hash; content_filters; content_build ;;
  runtime) content_runtime ;;
  all) content_hash; content_filters; content_build; content_ci_identity; content_runtime ;;
  *) fail 'Expected hash, filters, build, identity, static, runtime or all' ;;
esac
