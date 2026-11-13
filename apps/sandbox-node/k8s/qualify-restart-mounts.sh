#!/bin/sh
# B-test: agent restart with live EROFS/overlay/loop mounts. Isolated host only.
set -eu
test "${QUALIFICATION_ONLY:-}" = isolated
test -f /etc/execution-node/isolated-qualification
: "${QUAL_RELEASE_DIR:?verified release required}"
test "$(id -u)" = 0
pid=$(systemctl show execution-node.service --property=MainPID --value)
test "$pid" -gt 0
# Preserve the original namespace for cleanup even if the regression reappears.
exec 9<"/proc/$pid/ns/mnt"
path=$(mktemp -d /var/lib/builder/qual-restart.XXXXXX)
cleanup() {
  for target in merged lower writable; do
    nsenter --mount=/proc/self/fd/9 -- sh -c 'if mountpoint -q "$1"; then umount "$1"; fi' sh "$path/$target" || return 1
  done
  rm -rf "$path"
}
trap cleanup EXIT INT TERM
mkdir "$path/lower" "$path/writable" "$path/merged"
truncate -s 64M "$path/upper.ext4"
mkfs.ext4 -F -q "$path/upper.ext4"
nsenter --mount=/proc/self/fd/9 -- mount -t ext4 -o loop "$path/upper.ext4" "$path/writable"
nsenter --mount=/proc/self/fd/9 -- mkdir "$path/writable/upper" "$path/writable/work"
nsenter --mount=/proc/self/fd/9 -- mount -t erofs -o loop,ro "$QUAL_RELEASE_DIR/rootfs.erofs" "$path/lower"
nsenter --mount=/proc/self/fd/9 -- mount -t overlay overlay -o "lowerdir=$path/lower,upperdir=$path/writable/upper,workdir=$path/writable/work" "$path/merged"
nsenter --mount=/proc/self/fd/9 -- touch "$path/merged/restart-witness"
systemctl restart execution-node.service
next=$(systemctl show execution-node.service --property=MainPID --value)
test "$next" -gt 0
test "$next" != "$pid"
for target in merged lower writable; do
  mountpoint -q "$path/$target"
  nsenter -t "$next" -m -- mountpoint -q "$path/$target"
done
test -f "$path/merged/restart-witness"
for target in merged lower writable; do
  nsenter -t "$next" -m -- umount "$path/$target"
  if mountpoint -q "$path/$target"; then exit 1; fi
done
echo 'PASS agent restart with live mounts: host-visible and cleanable'
