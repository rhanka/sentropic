#!/bin/bash
# pack-immo-exchange-issuer-fixture.sh — M3 real-issuer fixture bundle (I861-EX13).
#
# Builds the checkpoint-pinned API image + companion bootstrap (ci-tools) image
# from a `git archive` snapshot (no operational .env is read: the snapshot
# contains no .env and every config value travels on the make command line),
# saves both tars plus issuer-receipt.json, then proves the real M3
# create/replay/conflict path in a disposable DB from the bootstrap image.
# No registry push, no live .env, no secret reads, no secret in any output.
#
# Usage: pack-immo-exchange-issuer-fixture.sh [--out DIR] [--verify RECEIPT]
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_BASE="$ROOT/tmp/ci-manifest-guard/immo-issuer"
API_PORT=9550
UI_PORT=5750
MAILDEV_UI_PORT=1650
FIXTURE_ENV=test-immo-861-mcp-registry
FIXTURE_REGISTRY=immo-issuer

fail() { echo "ERROR: $*" >&2; exit 1; }

cmd_verify() {
  local receipt="$1"
  [ -f "$receipt" ] || fail "receipt not found: $receipt"
  local ok=1
  local checkpoint api_id api_tar api_sha tool_id tool_tar tool_sha
  checkpoint="$(jq -r .checkpoint "$receipt")"
  api_id="$(jq -r .images[0].id "$receipt")"
  api_tar="$(jq -r .images[0].tar "$receipt")"
  api_sha="$(jq -r .images[0].tarSha256 "$receipt")"
  tool_id="$(jq -r .images[1].id "$receipt")"
  tool_tar="$(jq -r .images[1].tar "$receipt")"
  tool_sha="$(jq -r .images[1].tarSha256 "$receipt")"
  [ "$(docker image inspect "$api_id" --format '{{.Id}}' 2>/dev/null)" = "$api_id" ] || { echo "MISSING api image $api_id" >&2; ok=0; }
  [ "$(docker image inspect "$tool_id" --format '{{.Id}}' 2>/dev/null)" = "$tool_id" ] || { echo "MISSING bootstrap image $tool_id" >&2; ok=0; }
  [ -f "$api_tar" ] || { echo "MISSING $api_tar" >&2; ok=0; }
  [ -f "$tool_tar" ] || { echo "MISSING $tool_tar" >&2; ok=0; }
  [ "$(sha256sum "$api_tar" | cut -d' ' -f1)" = "$api_sha" ] || { echo "DIGEST api-image.tar" >&2; ok=0; }
  [ "$(sha256sum "$tool_tar" | cut -d' ' -f1)" = "$tool_sha" ] || { echo "DIGEST issuer-bootstrap-image.tar" >&2; ok=0; }
  if [ "$(git -C "$ROOT" rev-parse HEAD)" != "$checkpoint" ]; then
    echo "NOTE: receipt checkpoint $checkpoint differs from current HEAD (bundle stays valid for its checkpoint)" >&2
  fi
  [ "$ok" = 1 ] && echo "RECEIPT-OK $receipt" || fail "receipt verification failed"
}

if [ "${1:-}" = "--verify" ]; then cmd_verify "${2:?receipt path required}"; exit 0; fi
[ "${1:-}" = "--out" ] && OUT_BASE="$2"

cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "dirty tracked state — commit or stash first"
checkpoint="$(git rev-parse HEAD)"
short="${checkpoint:0:12}"
out="$OUT_BASE/$checkpoint"
mkdir -p "$out"

snap="$(mktemp -d)"
trap 'rm -rf "$snap"' EXIT
git archive HEAD | tar -x -C "$snap"
[ ! -e "$snap/.env" ] || fail "snapshot leaked .env"
echo "snapshot: no .env, checkpoint $checkpoint"

tool_version="$(make -s api-tool-version ENV="$FIXTURE_ENV")"
[ -n "$tool_version" ] || fail "empty API_TOOL_VERSION"
MAKE_ARGS="REGISTRY=$FIXTURE_REGISTRY API_PORT=$API_PORT UI_PORT=$UI_PORT MAILDEV_UI_PORT=$MAILDEV_UI_PORT ENV=$FIXTURE_ENV"

before_tags="$(docker images "$FIXTURE_REGISTRY/sentropic-api" --format '{{.Tag}}' 2>/dev/null || true)"
make -C "$snap" build-api-image TARGET=production $MAKE_ARGS
api_tag=""
for tag in $(docker images "$FIXTURE_REGISTRY/sentropic-api" --format '{{.Tag}}' 2>/dev/null); do
  case " $before_tags " in *" $tag "*) ;; *) api_tag="$tag";; esac
done
[ -n "$api_tag" ] || fail "no new api image tag built"
api_ref="$FIXTURE_REGISTRY/sentropic-api:$api_tag"
api_id="$(docker image inspect "$api_ref" --format '{{.Id}}')"
make -C "$snap" test-ci-api-runtime API_IMAGE_REF="$api_ref" $MAKE_ARGS >/dev/null
docker save "$api_ref" -o "$out/api-image.tar"
api_sha="$(sha256sum "$out/api-image.tar" | cut -d' ' -f1)"
echo "api image: $api_ref $api_id"

tool_ref="$FIXTURE_REGISTRY/sentropic-api-tools:$tool_version"
if docker image inspect "$tool_ref" >/dev/null 2>&1; then
  tool_reused=true
else
  tool_reused=false
  make -C "$snap" build-api-tool-image API_TOOL_VERSION="$tool_version" $MAKE_ARGS
fi
tool_id="$(docker image inspect "$tool_ref" --format '{{.Id}}')"
for f in api/drizzle/0042_immo_token_exchange.sql api/src/scripts/oauth-provision-exchange-client.ts; do
  docker run --rm "$tool_ref" test -f "/workspace/$f" || fail "bootstrap image lacks $f"
done
docker save "$tool_ref" -o "$out/issuer-bootstrap-image.tar"
tool_sha="$(sha256sum "$out/issuer-bootstrap-image.tar" | cut -d' ' -f1)"
echo "bootstrap image: $tool_ref $tool_id (reused=$tool_reused)"

net="immo-issuer-$short"
pg="immo-issuer-pg-$short"
cleanup() { docker rm -f "$pg" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap 'cleanup; rm -rf "$snap"' EXIT
dbpass="$(openssl rand -hex 16)"
docker network create "$net" >/dev/null
docker run -d --name "$pg" --network "$net" -e POSTGRES_USER=app -e POSTGRES_PASSWORD="$dbpass" -e POSTGRES_DB=app postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$pg" pg_isready -U app -d app >/dev/null 2>&1 && break; sleep 2; done
docker exec "$pg" pg_isready -U app -d app >/dev/null || fail "disposable postgres never ready"
dburl="postgres://app:$dbpass@$pg:5432/app"
docker run --rm --network "$net" -e DATABASE_URL="$dburl" -w /workspace/api "$tool_ref" npm run db:migrate >/dev/null
secret="$(openssl rand -hex 32)"
create_log="$out/.provision-create.log"
docker run --rm --network "$net" -e DATABASE_URL="$dburl" -e OAUTH_WORKLOAD_CLIENT_SECRET="$secret" -w /workspace/api "$tool_ref" npm run oauth:provision-exchange-client >"$create_log" 2>&1
grep -qF "$secret" "$create_log" && fail "secret leaked into provision output"
created=1
docker run --rm --network "$net" -e DATABASE_URL="$dburl" -e OAUTH_WORKLOAD_CLIENT_SECRET="$secret" -w /workspace/api "$tool_ref" npm run oauth:provision-exchange-client >/dev/null 2>&1 && replay_noop=1 || replay_noop=0
if docker run --rm --network "$net" -e DATABASE_URL="$dburl" -e OAUTH_WORKLOAD_CLIENT_SECRET="$secret" -e OAUTH_WORKLOAD_TARGET_AUD=https://127.0.0.1.invalid -w /workspace/api "$tool_ref" npm run oauth:provision-exchange-client >/dev/null 2>&1; then conflict_refused=0; else conflict_refused=1; fi
rows="$(docker exec "$pg" psql -U app -d app -tc 'SELECT COUNT(*) FROM service_clients;' | tr -d ' ')"
[ "$replay_noop" = 1 ] || fail "replay was not a no-op"
[ "$conflict_refused" = 1 ] || fail "policy conflict did not refuse"
[ "$rows" = 1 ] || fail "expected 1 service_clients row, got $rows"
rm -f "$create_log"
echo "M3 proof: created=$created replay_noop=$replay_noop conflict_refused=$conflict_refused rows=$rows"

jq -n \
  --arg checkpoint "$checkpoint" --arg branch "feat/immo-861-mcp-registry" \
  --arg built_at "$(date -u +%FT%TZ)" \
  --arg api_ref "$api_ref" --arg api_id "$api_id" --arg api_tar "$out/api-image.tar" --arg api_sha "$api_sha" \
  --arg tool_ref "$tool_ref" --arg tool_id "$tool_id" --arg tool_tar "$out/issuer-bootstrap-image.tar" --arg tool_sha "$tool_sha" \
  --argjson tool_reused "$tool_reused" \
  --argjson created "$created" --argjson replay_noop "$replay_noop" --argjson conflict_refused "$conflict_refused" --arg rows "$rows" \
  '{checkpoint: $checkpoint, branch: $branch, builtAt: $built_at, config: {apiPort: 9550, uiPort: 5750, maildevUiPort: 1650, env: "test-immo-861-mcp-registry", target: "production", registry: "immo-issuer", snapshotNoEnv: true, dirtyTracked: false},
    images: [{role: "api", ref: $api_ref, id: $api_id, tar: $api_tar, tarSha256: $api_sha},
             {role: "bootstrap", ref: $tool_ref, id: $tool_id, tar: $tool_tar, tarSha256: $tool_sha, reused: $tool_reused}],
    m8Proof: {created: $created, replayNoop: $replay_noop, conflictRefused: $conflict_refused, serviceClientRows: $rows}}' >"$out/issuer-receipt.json"
echo "receipt: $out/issuer-receipt.json"
cleanup
trap 'rm -rf "$snap"' EXIT
