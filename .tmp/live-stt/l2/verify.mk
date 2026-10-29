include packages/live-speech/verify.mk
ifneq ($(ENV),test-stt-l2)
$(error L2 local adapter requires ENV=test-stt-l2)
endif
scope-check:
	@files="$$(if git rev-parse -q --verify MERGE_HEAD >/dev/null; then git diff --name-only AUTO_MERGE; else { git diff --cached --name-only; git diff --name-only; }; fi | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"
integration-containment:
	@git show HEAD:.track/events.jsonl > /tmp/stt-l2-branch-events.jsonl
	@git show MERGE_HEAD:.track/events.jsonl > /tmp/stt-l2-main-events.jsonl
	@track events-contains --base /tmp/stt-l2-branch-events.jsonl --candidate .track/events.jsonl
	@track events-contains --base /tmp/stt-l2-main-events.jsonl --candidate .track/events.jsonl
down: live-speech-down
commit-audit:
	@git log --first-parent --no-merges --format='COMMIT %h' --numstat 581d6262a3d15e0cedde24b3debe3e3c6413e96b..HEAD | awk '/^COMMIT/ { if (count && lines >= 150) exit 1; count++; lines = 0; next } NF == 3 { lines += $$1 + $$2; if (lines > largest) largest = lines } END { if (lines >= 150) exit 1; print count " authored non-merge commits checked; largest " largest " changed lines" }'
	@if git log --first-parent --format='%B' 581d6262a3d15e0cedde24b3debe3e3c6413e96b..HEAD | grep -Ei '^(co-authored-by|generated-by):'; then exit 1; fi
	@git diff --check
