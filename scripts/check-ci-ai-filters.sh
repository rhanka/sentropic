#!/usr/bin/env bash
# Assert that the CI `ai` change-filter covers every AI-relevant service path.
#
# The AI test shards (test-api-ai) run only when `changes.ai` (or `changes.global`)
# is true, but ci-gate still requires every selected AI shard to be green. A
# false negative in the `ai` filter means: an AI service change skips the AI
# shards while moving AI behavior -> silent regression. This script makes that
# divergence a CI failure instead of a skipped suite.
#
# Coverage rule mirrors ci.yml: a path selects the AI shards when it matches an
# `ai` pattern or a `global` pattern (the shard `if:` accepts either).
# Patterns use dorny/paths-filter (minimatch) semantics: exact paths, `*`
# (any run of characters) and `prefix/**` (a whole subtree).
#
# When adding a new AI service, prompt config, or provider-routing path, add it
# to the `AI_PATHS` list below AND to the `ai` filter in ci.yml; this script
# fails until both agree.

set -euo pipefail

cd "$(dirname "$0")/.."

CI="${CI_YML:-../.github/workflows/ci.yml}"
[ -f "$CI" ] || CI=".github/workflows/ci.yml"

fail=0

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

# Minimatch-style coverage: exact match, or `*`/`**` glob match.
# In a bash `case` pattern `*` already spans `/`, so `prefix/**` covers the
# whole subtree and `stem-*.ts` covers every sibling file with that stem.
covers() {
  local pattern="$1" path="$2"
  case "$path" in ($pattern) return 0;; esac
  return 1
}

# Every path the AI shards exercise: shard specs, service backends, prompt
# configs, routes, and provider routing. Representative files stand in for
# their `/**` subtree; prompt configs and sibling backends are listed file by
# file so a hand-list regression fails here instead of skipping CI.
AI_PATHS="
api/tests/ai/initiative-generation-async.test.ts
api/tests/ai/executive-summary-sync.test.ts
api/src/services/tools.ts
api/src/services/tool-service.ts
api/src/services/context-initiative.ts
api/src/services/executive-summary.ts
api/src/services/queue-manager.ts
api/src/services/chat-service.ts
api/src/services/chat/postgres-chat-session-store.ts
api/src/services/comments/instance.ts
api/src/services/comments/comment-summary-mapper.ts
api/src/services/context-comments.ts
api/src/services/context-document-source.ts
api/src/services/document-text.ts
api/src/services/business/initiatives.ts
api/src/services/business/organizations.ts
api/src/services/business/folders.ts
api/src/services/llm-runtime/index.ts
api/src/services/llm-identity/directory.ts
api/src/services/llm-metering/index.ts
api/src/services/llm-account-transports.ts
api/src/routes/namespaces/business/initiatives.ts
api/src/routes/namespaces/workflows-queue.ts
api/src/routes/namespaces/config-product-ai.ts
api/src/config/default-org-aware-prompts.ts
api/src/config/default-chat-system.ts
api/src/config/default-agents-ai-priorities.ts
api/src/config/default-agents-shared.ts
api/src/config/default-matrix.ts
api/src/config/default-matrix-opportunity.ts
packages/llm-mesh/src/index.ts
packages/llm-gateway/src/index.ts
"

patterns="$(filter_patterns ai; filter_patterns global)"
if [ -z "$patterns" ]; then
  echo "::error::could not read the 'ai' or 'global' filter block from $CI"
  exit 1
fi

while IFS= read -r path; do
  [ -n "$path" ] || continue
  found=0
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    if covers "$pattern" "$path"; then found=1; break; fi
  done <<< "$patterns"
  if [ "$found" -eq 0 ]; then
    echo "::error::$path exercises the AI shards but no 'ai' or 'global' change-filter matches it. A change there skips test-api-ai while moving AI behavior. Add it to the 'ai' filter in ci.yml (prefer directory globs over a hand list)."
    fail=1
  fi
done <<< "$AI_PATHS"

if [ "$fail" -ne 0 ]; then
  echo "❌ CI ai change-filter misses AI service paths."
  exit 1
fi

echo "✅ CI ai change-filter covers every listed AI service path."
