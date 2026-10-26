include packages/live-speech/verify.mk
ifneq ($(ENV),test-stt-l2)
$(error L2 local adapter requires ENV=test-stt-l2)
endif
scope-check:
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"
down: live-speech-down
