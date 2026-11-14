ROOT := $(abspath ../../..)
ENV ?= feat-v8-spike
API_PORT ?= 9360
UI_PORT ?= 5560
MAILDEV_UI_PORT ?= 1460
IMAGE := mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948
TOOLS := $(ENV)-v8-tools
RESULTS := $(CURDIR)/results

.PHONY: preflight prepare test-e2e down-volumes
preflight:
	@test "$$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 30
	@ss -ltn '( sport = :$(API_PORT) or sport = :$(UI_PORT) or sport = :$(MAILDEV_UI_PORT) )'

prepare: preflight
	docker run --rm -v $(TOOLS):/tools -v $(CURDIR)/tools:/locked:ro -w /tools $(IMAGE) sh -ec 'cp /locked/package*.json /tools/; npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund'

test-e2e: preflight
	@mkdir -p $(RESULTS)
	docker run --rm --name $(ENV)-browser --ipc=host -e SPIKE_BROWSER="$(SPIKE_BROWSER)" -e SPIKE_SPEC="$(SPIKE_SPEC)" -v $(TOOLS):/tools -v $(ROOT):/repo:ro -v $(RESULTS):/results -w /tools $(IMAGE) sh -ec 'run_dir=$$(mktemp -d /tools/run.XXXXXX); cp /repo/e2e/tests/harness/*.ts "$$run_dir/"; ./node_modules/.bin/playwright test --config "$$run_dir/playwright.config.ts"'

down-volumes:
	docker volume rm $(TOOLS)
