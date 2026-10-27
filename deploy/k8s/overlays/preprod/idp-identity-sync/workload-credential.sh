# Sourced before psql: plaintext stays in this process, never in SQL or argv.
prepare_workload_credential() {
  unset IMMO_MCP_WORKLOAD_CLIENT_SECRET_HASH
  if [ "${IMMO_MCP_WORKLOAD_CLIENT_SECRET+x}" = x ]; then
    case "$IMMO_MCP_WORKLOAD_CLIENT_SECRET" in
      *[!0-9a-f]*|'') return 1 ;;
    esac
    [ "${#IMMO_MCP_WORKLOAD_CLIENT_SECRET}" -eq 64 ] || return 1
    IMMO_MCP_WORKLOAD_CLIENT_SECRET_HASH=$(printf '%s' "$IMMO_MCP_WORKLOAD_CLIENT_SECRET" | sha256sum)
    export IMMO_MCP_WORKLOAD_CLIENT_SECRET_HASH="${IMMO_MCP_WORKLOAD_CLIENT_SECRET_HASH%% *}"
  fi
  unset IMMO_MCP_WORKLOAD_CLIENT_SECRET
}
