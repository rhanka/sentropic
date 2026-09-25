#!/usr/bin/env bash
# Host orchestration for `make check-publishable-manifests` (BRCI-EX3).
# Classification and every pack run in Docker through child Make targets; diagnostics are
# aggregated so every package is reported before the final exit status.
set -uo pipefail

env_name="${1:?usage: check-publishable-manifests.sh <ENV>}"
report_dir="${MANIFEST_REPORT_DIR:-tmp/ci-manifest-guard/manifests}"
block_file="${report_dir}/block-packages.txt"
status=0

mkdir -p "$report_dir"
rm -f "$block_file" "${report_dir}/classification.json" "${report_dir}"/*.receipt.json "${report_dir}"/*.github-output

make publishable-manifests-inventory MANIFEST_REPORT_DIR="$report_dir" ENV="$env_name" || status=1

if [ ! -f "$block_file" ]; then
  echo "::error title=Publishable manifest::inventory produced no classification (context or registry ERROR: re-run, not debt, unless the context itself is invalid)"
  exit 1
fi

while IFS= read -r slug; do
  [ -n "$slug" ] || continue
  if ! printf '%s' "$slug" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
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
