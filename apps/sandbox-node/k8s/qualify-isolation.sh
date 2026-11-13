#!/bin/sh
# Real runsc two-tenant qualification. Isolated host only; no service restart.
set -eu
test "${QUALIFICATION_ONLY:-}" = isolated
test -f /etc/execution-node/isolated-qualification
: "${QUAL_RELEASE_DIR:?verified release required}"
test "$(id -u)" = 0
exec "$QUAL_RELEASE_DIR/execution-node" --qualify-isolation
