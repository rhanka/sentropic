#!/usr/bin/env sh
# Fail when a numbered root E2E spec is not selected by the default `make test-e2e`
# groups or by any blocking CI e2e lane. Usage: check-spec-lanes.sh "<default groups>"
set -eu

default_groups="${1:?default E2E groups required}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
ci_file="$root/.github/workflows/ci.yml"

ci_groups="$(sed -n 's/^[[:space:]]*e2e_groups:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$ci_file" | tr '\n' ' ')"
if [ -z "$(echo "$ci_groups" | tr -d ' ')" ]; then
  echo "❌ No e2e_groups lane found in $ci_file"
  exit 1
fi

missing=0
count=0
for spec in "$root"/e2e/tests/[0-9][0-9][-_]*.spec.ts; do
  [ -e "$spec" ] || continue
  count=$((count + 1))
  name="$(basename "$spec")"
  group="$(printf '%s' "$name" | cut -c1-2)"
  case " $default_groups " in
    *" $group "*) ;;
    *) echo "❌ e2e/tests/$name: group $group missing from default E2E_GROUPS"; missing=1 ;;
  esac
  case " $ci_groups " in
    *" $group "*) ;;
    *) echo "❌ e2e/tests/$name: group $group has no CI e2e lane"; missing=1 ;;
  esac
done

if [ "$count" -eq 0 ]; then
  echo "❌ No numbered E2E spec found"
  exit 1
fi
if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "✅ All $count numbered E2E specs are selected (default: $default_groups; CI lanes: $ci_groups)"
