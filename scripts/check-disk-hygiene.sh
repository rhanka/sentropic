#!/usr/bin/env bash
# Self-test for the DH01-EX1 disk-hygiene targets (conductor 2026-11-04).
# Covers the dry run and the root-owned skip. Safe: allowed cases use
# `make -n` or the targets' own DRY_RUN=1 default (no removal, no prune);
# live runs are guard refusals (exit before docker) and default dry-runs.

set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { printf '%s\n' "$*"; }
err()  { printf '::error::%s\n' "$*"; fail=1; }

# expect_contains <label> <needle> <cmd...>
expect_contains() {
  local label="$1" needle="$2"; shift 2
  local out rc
  set +e; out="$("$@" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ]; then err "$label: '$*' failed (rc=$rc):"; note "$out"; return; fi
  if ! grep -qF -- "$needle" <<<"$out"; then err "$label: '$*' misses '$needle':"; note "$out"; return; fi
  note "ok: $label contains '$needle'"
}

# expect_absent <label> <needle> <cmd...>
expect_absent() {
  local label="$1" needle="$2"; shift 2
  local out rc
  set +e; out="$("$@" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ]; then err "$label: '$*' failed (rc=$rc):"; note "$out"; return; fi
  if grep -qF -- "$needle" <<<"$out"; then err "$label: '$*' has '$needle':"; note "$out"; return; fi
  note "ok: $label has no '$needle'"
}

# Table dry-run assertions: label;needle;make args (after `-n`).
while IFS=';' read -r label needle args; do
  [ -z "$label" ] && continue
  # shellcheck disable=SC2086
  expect_contains "$label" "$needle" make --no-print-directory -n $args
done <<'EOF'
builder-prune default;docker builder prune -f --keep-storage "5GB";docker-builder-prune
disk-hygiene down step;down --volumes --remove-orphans;disk-hygiene ENV=test-disk-hygiene
disk-hygiene prune step;docker builder prune -f --keep-storage;disk-hygiene ENV=test-disk-hygiene
prune-merged lists find;find;worktrees-prune-merged
prune-merged protects main-ro;main-ro;worktrees-prune-merged
prune-merged root-owned skip;-user root;worktrees-prune-merged
prune-merged dirty skip;status --porcelain;worktrees-prune-merged
prune-merged uses remove;git worktree remove;worktrees-prune-merged
prune-merged documents dry-run;DRY_RUN=0;worktrees-prune-merged
purge scopes tmp/worktrees;tmp/worktrees;worktrees-purge-root-residue
purge protects main-ro;main-ro;worktrees-purge-root-residue
purge uses root container;docker run --rm;worktrees-purge-root-residue
purge container rm;rm -rf;worktrees-purge-root-residue
purge documents dry-run;DRY_RUN=0;worktrees-purge-root-residue
EOF

# Builder prune override (needs an env assignment, outside the table).
expect_contains 'builder-prune override' '--keep-storage "10GB"' \
  make --no-print-directory -n docker-builder-prune DOCKER_BUILDER_KEEP=10GB

# Absence assertions (never --force, never host sudo, never depth-limited).
expect_absent 'prune-merged never forces' '--force' make --no-print-directory -n worktrees-prune-merged
expect_absent 'prune-merged unbounded root check' '-maxdepth' make --no-print-directory -n worktrees-prune-merged
expect_absent 'purge needs no host sudo' 'sudo' make --no-print-directory -n worktrees-purge-root-residue
expect_absent 'purge never forces' '--force' make --no-print-directory -n worktrees-purge-root-residue

# disk-hygiene inherits the down-volumes guard: ENV=dev refused before docker.
{
  out=""; rc=0
  set +e; out="$(make --no-print-directory disk-hygiene ENV=dev 2>&1)"; rc=$?; set -e
  if [ "$rc" -eq 0 ]; then err "disk-hygiene guard: ENV=dev unexpectedly SUCCEEDED"
  elif ! grep -q 'refuses ENV=' <<<"$out"; then err "disk-hygiene guard: no refusal (rc=$rc):"; note "$out"
  else note "ok: disk-hygiene ENV=dev refused (rc=$rc)"; fi
}

# prune-merged live default dry-run: rc 0, summary printed, nothing changed.
# Plain-dir fixture under git-ignored tmp/ exercises enumeration + skip path.
{
  mkdir -p "tmp/worktrees/__hygiene-fixture-plain"
  before="$(git worktree list | wc -l)"
  out=""; rc=0
  set +e; out="$(make --no-print-directory worktrees-prune-merged 2>&1)"; rc=$?; set -e
  after="$(git worktree list | wc -l)"
  rm -rf "tmp/worktrees/__hygiene-fixture-plain"; rmdir "tmp/worktrees" 2>/dev/null || true
  [ "$rc" -eq 0 ] && note "ok: prune-merged default dry-run exits 0" || { err "prune-merged dry-run failed (rc=$rc):"; note "$out"; }
  for needle in 'Removed:' 'Skipped:' 'DRY_RUN=0' 'not a registered git worktree'; do
    grep -qF -- "$needle" <<<"$out" && note "ok: prune-merged prints '$needle'" \
      || { err "prune-merged misses '$needle':"; note "$out"; }
  done
  [ "$before" = "$after" ] && note "ok: prune-merged changed no worktree ($before)" \
    || { err "prune-merged changed worktrees ($before -> $after):"; note "$out"; }
}

# Root-owned skip predicate discriminates (same `find -user root` form).
{
  [ -n "$(find / -maxdepth 0 -user root -print -quit 2>/dev/null || true)" ] \
    && note "ok: root-owned positive control detected '/'" \
    || err "root-owned skip: positive control failed"
  sandbox="$(mktemp -d)"; touch "$sandbox/probe"
  [ -z "$(find "$sandbox" -user root -print -quit 2>/dev/null)" ] \
    && note "ok: root-owned negative control clean" \
    || err "root-owned skip: own file flagged as root-owned"
  rm -rf "$sandbox"
}

# Deep root-owned files (below 4 levels) are still detected by the unbounded check.
{
  deep="$(find /usr -mindepth 5 -user root -print -quit 2>/dev/null || true)"
  if [ -z "$deep" ]; then err "deep root-owned: no root-owned file below 4 levels under /usr"
  else
    note "ok: deep root-owned fixture '$deep'"
    ancestor="$deep"; for _ in 1 2 3 4 5; do ancestor="${ancestor%/*}"; done
    if [ -n "$(find "$ancestor" -user root -path "$deep" -print -quit 2>/dev/null)" ]; then
      note "ok: unbounded find detects '$deep' from '$ancestor'"
    else err "deep root-owned: unbounded find missed '$deep' from '$ancestor'"; fi
    if [ -z "$(find "$ancestor" -maxdepth 4 -user root -path "$deep" -print -quit 2>/dev/null)" ]; then
      note "ok: old -maxdepth 4 form misses '$deep' (bug the unbounded check fixes)"
    else err "deep root-owned: -maxdepth 4 unexpectedly matched '$deep'"; fi
  fi
}

# purge live default dry-run: rc 0, deletes nothing, skipped summary printed.
{
  mkdir -p "tmp/worktrees/__hygiene-fixture-plain"
  out=""; rc=0
  set +e; out="$(make --no-print-directory worktrees-purge-root-residue 2>&1)"; rc=$?; set -e
  rm -rf "tmp/worktrees/__hygiene-fixture-plain"; rmdir "tmp/worktrees" 2>/dev/null || true
  [ "$rc" -eq 0 ] && note "ok: purge default dry-run exits 0" || { err "purge dry-run failed (rc=$rc):"; note "$out"; }
  if grep -qF -- 'DRY_RUN=0' <<<"$out"; then note "ok: purge documents the DRY_RUN=0 run"
  elif grep -qF -- 'No root-owned residue' <<<"$out"; then note "ok: purge reports no residue (nothing to delete)"
  else err "purge: misses DRY_RUN=0 hint and empty result:"; note "$out"; fi
  grep -qF -- 'Skipped:' <<<"$out" && note "ok: purge prints the skipped summary" \
    || { err "purge: misses the skipped summary:"; note "$out"; }
}

if [ "$fail" -ne 0 ]; then note "check-disk-hygiene: FAILED"; exit 1; fi
note "check-disk-hygiene: all green"
