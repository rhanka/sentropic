#!/usr/bin/env bash
set -euo pipefail
recipe="$(pwd)/packages/artifacts/probe/contract-gaps.mk"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
print_paths=$'print-paths:\n\t@printf "%s\\n" "$(OFFLINE_TOOLS)" "$(OFFLINE_LINT_TOOLS)" "$(OFFLINE_CACHE)"'
actual="$(make --no-print-directory -s -C "$test_root" -f "$recipe" --eval "$print_paths" print-paths ENV=test-861-gaps)"
expected="$(printf '%s\n' "$test_root/node_modules" "$test_root/node_modules" "$HOME/.npm/_cacache")"
test "$actual" = "$expected" || { printf 'Nonportable defaults:\n%s\n' "$actual"; exit 1; }
actual="$(make --no-print-directory -s -C "$test_root" -f "$recipe" --eval "$print_paths" print-paths OFFLINE_TOOLS=/tools OFFLINE_LINT_TOOLS=/lint OFFLINE_CACHE=/cache ENV=test-861-gaps)"
test "$actual" = $'/tools\n/lint\n/cache'
! grep -q '/home/antoinefa' "$recipe"
printf 'Qualification paths: portable defaults and overrides passed\n'
