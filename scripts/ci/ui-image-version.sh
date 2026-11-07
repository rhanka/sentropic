#!/usr/bin/env bash
set -euo pipefail

# Cover every production COPY, workspace install and embedded desktop source.
# Git excludes generated downloads/builds, which are rebuilt from these inputs.
paths=(package.json package-lock.json api/package.json ui packages Makefile .dockerignore
  .security/audit-gate.mjs .security/audit-allowlist.json
  scripts/ci/locked-tools.mjs scripts/ci/tool-locks.json scripts/ci/ui-image-version.sh)
if [ "${1:-}" = --paths ]; then printf '%s\n' "${paths[@]}"; exit 0; fi

{
  printf 'canonical-ui-v2\0'
  # Make passes platform, production extension profile/endpoints and tool image.
  printf '%s\0' "$@"
  git ls-files --cached --others --exclude-standard --deduplicate -z -- "${paths[@]}" |
    LC_ALL=C sort -z |
    while IFS= read -r -d '' file; do
      if [ -f "$file" ]; then printf '%s\0' "$file"; fi
    done | xargs -0 -r sha256sum
} | sha256sum | cut -c1-6
