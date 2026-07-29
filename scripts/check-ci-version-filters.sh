#!/usr/bin/env bash
# Assert that the CI change-filters are a SUPERSET of the image content-hash inputs.
#
# Two independent definitions of "the api/ui changed" coexist:
#   - Makefile  API_VERSION / UI_VERSION  -> decides which image TAG is deployed
#   - ci.yml    changes.api / changes.ui  -> decides whether publish-*-image RUNS
#
# Nothing forces them to agree. A path that feeds the hash but is missing from the
# filter means: publish is SKIPPED while the hash MOVES, so deploy-preprod pins an
# image tag that was never built. This script makes that divergence a CI failure
# instead of a broken deployment.
#
# A hash input is covered when a filter pattern matches it exactly, or when a
# `prefix/**` pattern is a prefix of it. `global` counts as coverage for both
# components because publish-*-image is gated on `<component> == true || global == true`.

set -euo pipefail

cd "$(dirname "$0")/.."

MAKEFILE="Makefile"
CI="../.github/workflows/ci.yml"
[ -f "$CI" ] || CI=".github/workflows/ci.yml"

fail=0

# Extract the space-separated path list embedded in an `export <VAR> ?= $(shell echo "...")` line.
hash_inputs() {
  sed -n "s/^export $1[[:space:]]*?=.*echo \"\([^\"]*\)\".*/\1/p" "$MAKEFILE" | tr ' ' '\n' | sed '/^$/d'
}

# Extract the `- 'pattern'` entries of one dorny/paths-filter block from the `filters: |` literal.
# POSIX awk only (no gawk 3-arg match). Anchored on the exact indentation of the
# block: filter keys sit at 12 spaces, their entries at 14 — which also prevents
# collisions with same-named keys elsewhere in the workflow.
filter_patterns() {
  awk -v want="$1" '
    /^            [a-z_]+:[[:space:]]*$/ {
      key = $0
      gsub(/[[:space:]]/, "", key)
      sub(/:$/, "", key)
      inblock = (key == want)
      next
    }
    inblock && /^              -[[:space:]]*\047/ {
      line = $0
      sub(/^[^\047]*\047/, "", line)
      sub(/\047.*$/, "", line)
      print line
      next
    }
    inblock && $0 !~ /^[[:space:]]*-/ && $0 !~ /^[[:space:]]*$/ { inblock = 0 }
  ' "$CI"
}

covers() {
  local pattern="$1" path="$2"
  [ "$pattern" = "$path" ] && return 0
  case "$pattern" in
    */\*\*)
      local prefix="${pattern%/\*\*}"
      [ "$path" = "$prefix" ] && return 0
      case "$path" in "$prefix"/*) return 0 ;; esac
      ;;
  esac
  return 1
}

check_component() {
  local var="$1" filter="$2"
  local patterns path pattern found

  patterns="$(filter_patterns "$filter"; filter_patterns global)"
  if [ -z "$patterns" ]; then
    echo "::error::could not read the '$filter' or 'global' filter block from $CI"
    fail=1
    return
  fi

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    found=0
    while IFS= read -r pattern; do
      [ -n "$pattern" ] || continue
      if covers "$pattern" "$path"; then found=1; break; fi
    done <<< "$patterns"
    if [ "$found" -eq 0 ]; then
      echo "::error::$var feeds the image tag from '$path', but no '$filter' or 'global' change-filter matches it. A change there moves the deployed tag WITHOUT running publish-*-image, so deploy pins an image that was never built. Add it to the '$filter' filter in ci.yml."
      fail=1
    fi
  done <<< "$(hash_inputs "$var")"
}

check_component API_VERSION api
check_component UI_VERSION ui

if [ "$fail" -ne 0 ]; then
  echo "❌ CI change-filters are not a superset of the image content-hash inputs."
  exit 1
fi

echo "✅ CI change-filters cover every API_VERSION/UI_VERSION hash input."
