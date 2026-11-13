#!/bin/sh
# Real runsc two-tenant qualification. Isolated host only; no service restart.
set -eu
test "${QUALIFICATION_ONLY:-}" = isolated
test -f /etc/execution-node/isolated-qualification
: "${QUAL_RELEASE_DIR:?verified release required}"
test "$(id -u)" = 0
(cd "$QUAL_RELEASE_DIR" && sha256sum -c SHA256SUMS >/dev/null)
PATH=$(sed -n 's/^PATH=//p' "$QUAL_RELEASE_DIR/agent.env")
test -n "$PATH"
export PATH
forward_max=$(sed -n 's/^EXECUTION_NODE_PORT_FORWARD_MAX=//p' "$QUAL_RELEASE_DIR/agent.env")
set --
for property in User Group UMask CapabilityBoundingSet SystemCallFilter MemoryMax MemoryMin MemorySwapMax CPUWeight TasksMax OOMPolicy; do
  value=$(sed -n "s/^$property=//p" "$QUAL_RELEASE_DIR/execution-node.service")
  test -n "$value"
  set -- "$@" "--property=$property=$value"
done
exec systemd-run --wait --pipe --collect --service-type=exec "$@" \
  --setenv=QUALIFICATION_ONLY=isolated --setenv="PATH=$PATH" \
  --setenv="QUAL_HOST_PUBLIC_IP=${QUAL_HOST_PUBLIC_IP:-}" \
  --setenv="EXECUTION_NODE_PORT_FORWARD_MAX=$forward_max" \
  --setenv="QUALIFICATION_TIMEOUT_MS=${QUALIFICATION_TIMEOUT_MS:-120000}" \
  "$QUAL_RELEASE_DIR/execution-node" --qualify-isolation
