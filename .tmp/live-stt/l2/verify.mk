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
