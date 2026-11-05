#!/usr/bin/env sh
# Reconcile the explicit file/project manifest with the blocking CI matrix.
set -eu

default_groups="${1:?default E2E groups required}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

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
done

if [ "$count" -eq 0 ]; then
  echo "❌ No numbered E2E spec found"
  exit 1
fi
if [ "$missing" -ne 0 ]; then
  exit 1
fi
exec node scripts/ci/browser-shards.mjs inventory
