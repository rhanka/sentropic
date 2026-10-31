include docs/baselines/app-cm-w0/probe.mk
W0_REFRESH_EXPECT ?= green

.PHONY: w0-refresh-workspace w0-refresh-payload w0-refresh-ps
w0-refresh-workspace: w0-probe-env
	@$(W0_COMPOSE) run --rm --no-deps --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e W0_REFRESH_EXPECT=$(W0_REFRESH_EXPECT) -v "$(W0_OUTPUT_DIR):/out" qualification sh /workspace/docs/baselines/app-cm-w0/refresh-workspace.sh

w0-refresh-payload: w0-probe-env
	@$(W0_COMPOSE) run --rm --no-deps --user "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(W0_OUTPUT_DIR):/out" qualification node /workspace/docs/baselines/app-cm-w0/refresh-payload.mjs

w0-refresh-ps:
	@$(W0_COMPOSE) ps --all --format json

.PHONY: w0-refresh-record
w0-refresh-record: w0-probe-env
	@$(W0_COMPOSE) run --rm --no-deps --user "$$(id -u):$$(id -g)" -e W0_REFRESH_SOURCE_SHA=$$(git rev-parse HEAD) -e W0_REFRESH_LOCK_BLOB=$$(git hash-object package-lock.json) -e W0_REFRESH_API_LOCK_BLOB=$$(git hash-object api/package-lock.json) -v "$(W0_OUTPUT_DIR):/out" qualification node /workspace/docs/baselines/app-cm-w0/refresh-record.mjs
