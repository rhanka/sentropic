#!/usr/bin/env bash
# Host orchestration for `make check-publishable-manifests` (BRCI-EX3).
# Classification and every pack run in Docker through child Make targets; diagnostics are
# aggregated so every package is reported before the final exit status.
set -uo pipefail

env_name="${1:?usage: check-publishable-manifests.sh <ENV> [siblings <slug> tmp/ci-manifest-guard/siblings/<slug>]}"

# Same-PR sibling candidates for one BLOCK package: plan (Docker), full BLOCK packs, receipt collection.
if [ "${2:-}" = siblings ]; then
  slug="${3:?package slug required}"
  dir="${4:?sibling directory required}"
  # Whole-string checks (a glob class, not line-based grep): newlines and any non-slug byte are refused.
  case "$slug" in ''|-*|*[!a-z0-9-]*) echo "ERROR: invalid package slug: ${slug}"; exit 1 ;; esac
  # `rm -rf "$dir"` below: the directory is derived from the validated slug, never chosen by the caller;
  # the argument is kept for compatibility and must equal the derived value exactly.
  expected="tmp/ci-manifest-guard/siblings/${slug}"
  [ "$dir" = "$expected" ] || { echo "ERROR: sibling directory must be exactly ${expected} (got '${dir}')"; exit 1; }
  [ ! -e "$dir/.git" ] || { echo "ERROR: sibling directory ${dir} contains .git (refusing to delete a checkout)"; exit 1; }
  status=0
  rm -rf "$dir" && mkdir -p "$dir/receipts"
  make publishable-sibling-plan PACKAGE="$slug" SIBLING_DIR="$dir" ENV="$env_name" || exit 1
  while IFS= read -r sib; do
    [ -n "$sib" ] || continue
    make "pack-${sib}" MANIFEST_SEVERITY=block PACK_DESTINATION="$dir/${sib}" MANIFEST_REPORT_DIR="$dir/receipts" ENV="$env_name" || status=1
  done < "$dir/plan.txt"
  [ "$status" -eq 0 ] || { echo "::error title=Publishable manifest::a same-PR sibling pack failed for ${slug}"; exit 1; }
  make publishable-sibling-collect SIBLING_DIR="$dir" ENV="$env_name"
  exit $?
fi
report_dir="${MANIFEST_REPORT_DIR:-tmp/ci-manifest-guard/manifests}"
block_file="${report_dir}/block-packages.txt"
status=0

mkdir -p "$report_dir"
rm -f "$block_file" "${report_dir}/classification.json" "${report_dir}"/*.receipt.json "${report_dir}"/*.github-output

make publishable-manifests-inventory MANIFEST_REPORT_DIR="$report_dir" ENV="$env_name" || status=1

if [ ! -f "$block_file" ]; then
  echo "::error title=Publishable manifest::inventory produced no classification: see the classification ERROR above and ${report_dir}/classification.json (only an error the classifier marks transient is 're-run, not debt')"
  exit 1
fi

while IFS= read -r slug; do
  [ -n "$slug" ] || continue
  if case "$slug" in ''|-*|*[!a-z0-9-]*) true ;; *) false ;; esac; then
    echo "::error title=Publishable manifest::invalid package slug in BLOCK list: ${slug}"
    status=1
    continue
  fi
  if ! grep -Eq "^pack-${slug}:" Makefile; then
    echo "::error file=packages/${slug}/package.json,title=Publishable manifest::missing pack lane: make pack-${slug} does not exist"
    status=1
    continue
  fi
  echo "::group::make pack-${slug} (BLOCK candidate)"
  make "pack-${slug}" MANIFEST_SEVERITY=block MANIFEST_REPORT_DIR="$report_dir" ENV="$env_name" || status=1
  echo "::endgroup::"
done < "$block_file"

if [ "$status" -ne 0 ]; then
  echo "check-publishable-manifests: FAIL (see annotations and ${report_dir})"
else
  echo "check-publishable-manifests: PASS (${report_dir})"
fi
exit "$status"
