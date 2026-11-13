/** Runs after unshare, before runsc. Any unexpected inventory aborts the launch. */
export const privateNetworkScript = `
ip link set lo up
links=$(ip -o link show)
printf '%s\n' "$links" | awk '
  { n++; if ($2 != "lo:" || $3 !~ /[<,]UP[,>]/) bad=1 }
  END { exit (n != 1 || bad) }' || { echo 'private netns must contain only UP lo' >&2; exit 1; }
routes4=$(ip -o -4 route show table all)
routes6=$(ip -o -6 route show table all)
printf '%s\n' "$routes4" | awk '
  NF { if (($1 != "local" && $1 != "broadcast") || $2 !~ /^127\\./ || $3 != "dev" || $4 != "lo") exit 1 }' || { echo 'private netns has non-loopback IPv4 route' >&2; exit 1; }
printf '%s\n' "$routes6" | awk '
  NF { if ($1 != "local" || ($2 != "::1" && $2 != "::1/128") || $3 != "dev" || $4 != "lo") exit 1 }' || { echo 'private netns has non-loopback IPv6 route' >&2; exit 1; }
exec "$@"`;
