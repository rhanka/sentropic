#!/bin/sh
set -eu
: "${RELEASE_DIR:?digest-named release required}"
digest=${RELEASE_DIR##*/}
case "$digest" in *[!a-f0-9]*|'') echo 'invalid release digest' >&2; exit 1;; esac
test "${#digest}" -eq 64
test "$RELEASE_DIR" = "/opt/execution-node/releases/$digest"
cd "$RELEASE_DIR"
sha256sum -c SHA256SUMS
exec ./execution-node
