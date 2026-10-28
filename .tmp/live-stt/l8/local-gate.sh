#!/usr/bin/env bash
set -eu
export PATH=/home/antoinefa/.cargo/bin:/home/antoinefa/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
cd /home/antoinefa/src/sentropic/tmp/worktrees/stt-l8

host_make=/tmp/stt-l8-host.mk
receipt_dir=/home/antoinefa/src/sentropic/.tmp/live-stt/l8-local
rtk make -f "$host_make" author-host CMD="mkdir -p $receipt_dir" ENV=test-stt-l8
exec >>"$receipt_dir/package-test.log" 2>&1
now="$(rtk make -f "$host_make" author-host CMD='date -u +%s' ENV=test-stt-l8)"
if [ "$now" -lt 1793134800 ]; then
  printf 'Refused: local Docker reservation lasts until 2026-10-27 21:00 UTC.\n'
  exit 1
fi
rtk make -f "$host_make" author-host \
  CMD='harness check branch --current-branch "$$(git branch --show-current)" --expected-branch feat/live-stt-l8 --json' ENV=test-stt-l8
head="$(rtk make -f "$host_make" author-host CMD='git rev-parse HEAD' ENV=test-stt-l8)"
if [ "$head" != "${STT_L8_EXPECTED_HEAD:?Expected qualification head is required}" ]; then
  printf 'Refused: qualification head changed. expected=%s actual=%s\n' "$STT_L8_EXPECTED_HEAD" "$head"
  exit 1
fi
rtk make -f "$host_make" author-host CMD='test -z "$$(git status --porcelain --untracked-files=no)"' ENV=test-stt-l8
printf 'head=%s\nstarted_epoch=%s\n' "$head" "$now" >"$receipt_dir/result.txt"
test_status=0
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock rtk make test-llm-gateway ENV=test-stt-l8 || test_status=$?
cleanup_status=0
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock rtk make down ENV=test-stt-l8 || cleanup_status=$?
printf 'test_exit=%s\ncleanup_exit=%s\n' "$test_status" "$cleanup_status" >>"$receipt_dir/result.txt"
if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
exit "$cleanup_status"
