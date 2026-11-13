/** Runs after unshare, before runsc. Any unexpected inventory aborts the launch. */
export const privateNetworkInventory = `
test "$(stat -Lc %i /proc/self/ns/net)" != "$(stat -Lc %i /proc/1/ns/net)" || exit 1
links=$(ip -o link show) || exit 1
printf '%s\n' "$links" | awk '
  { n++; if ($2 != "lo:" || $3 !~ /[<,]UP[,>]/) bad=1 }
  END { exit (n != 1 || bad) }' || { echo 'private netns must contain only UP lo' >&2; exit 1; }
routes4=$(ip -o -4 route show table all) || exit 1
routes6=$(ip -o -6 route show table all) || exit 1
addresses=$(ip -o addr show) || exit 1
printf '%s\\n' "$addresses" | awk '
  NF { if ($2 != "lo" || !(($3 == "inet" && $4 == "127.0.0.1/8") || ($3 == "inet6" && $4 == "::1/128"))) bad=1;
       if ($3 == "inet") v4++; if ($3 == "inet6") v6++ }
  END { exit (bad || v4 != 1 || v6 != 1) }' || exit 1
printf '%s\n' "$routes4" | awk '
  NF { if (($1 != "local" && $1 != "broadcast") || $2 !~ /^127\\./ || $3 != "dev" || $4 != "lo") exit 1 }' || { echo 'private netns has non-loopback IPv4 route' >&2; exit 1; }
printf '%s\n' "$routes6" | awk '
  NF { if ($1 == "local") { if (($2 != "::1" && $2 != "::1/128") || $3 != "dev" || $4 != "lo") exit 1 }
       else if (($1 != "::1" && $1 != "::1/128") || $2 != "dev" || $3 != "lo") exit 1 }' || { echo 'private netns has non-loopback IPv6 route' >&2; exit 1; }
`;

export const privateNetworkScript = `
ip link set lo up
if ! ( set -e; ${privateNetworkInventory} ); then echo network_isolation_violation >&2; exit 78; fi
stat -Lc %i /proc/self/ns/net > "$1"
shift
exec "$@"`;
