NODE_IMAGE ?= node:24-bookworm-slim
PROBE_IMAGE ?= mcr.microsoft.com/playwright:v1.63.0
DEPS_VOLUME ?= sentropic-governance-contract-deps
PROBE_VOLUME ?= sentropic-governance-contract-probe
R11_SHOTS_DIR ?= $(CURDIR)/.cache/r11-shots
MOUNTS = -v "$(CURDIR)/..:/inputs" -v "$(DEPS_VOLUME):/inputs/kit/node_modules" -w /inputs/kit
USER_ARGS = --user "$$(id -u):$$(id -g)"
NODE = docker run --rm --cpus=2 --memory=2048m --pids-limit=256 $(USER_ARGS) $(MOUNTS) $(NODE_IMAGE)
PROBE = docker run --rm $(USER_ARGS) $(MOUNTS) -v "$(PROBE_VOLUME):/app:ro" $(PROBE_MOUNTS) $(PROBE_IMAGE)

.PHONY: install prepare build check-source check-geometry check-browser check-convergence check-performance check-content export-static check-static validate deliver checksums
install:
	@docker run --rm $(MOUNTS) $(NODE_IMAGE) npm ci --force --no-audit --no-fund
	@docker run --rm -v "$(PROBE_VOLUME):/app" $(PROBE_IMAGE) npm install --prefix /app --no-audit --no-fund playwright@1.63.0

prepare:
	@mkdir -p .cache
	@$(NODE) node scripts/prepare-summary.mjs > .cache/summary.log
	@$(NODE) node scripts/prepare-scenes.mjs > .cache/prepare.log
	@$(subst --cpus=2,--cpus=4,$(NODE)) node scripts/prepare-fold-plans.mjs > .cache/fold-plans.log
	@$(NODE) node scripts/check-source.mjs --sync-hash
.PHONY: prepare-fold-plans
prepare-fold-plans:
	@mkdir -p .cache
	@$(subst --cpus=2,--cpus=4,$(NODE)) node scripts/prepare-fold-plans.mjs > .cache/fold-plans.log

build:
	@mkdir -p .cache
	@$(NODE) node scripts/check-source.mjs --sync-hash
	@$(NODE) npm run build > .cache/build.log 2>&1 || { tail -n 50 .cache/build.log; exit 1; }
	@tail -n 6 .cache/build.log

check-source:
	@$(NODE) node scripts/check-source.mjs
check-geometry:
	@mkdir -p .cache
	@$(NODE) node scripts/check-geometry.mjs
check-browser:
	@mkdir -p .cache
	@$(PROBE) node scripts/check-browser.mjs
check-convergence:
	@mkdir -p .cache
	@$(PROBE) node scripts/check-convergence.mjs
check-performance:
	@mkdir -p .cache
	@$(PROBE) node scripts/check-performance.mjs
check-content:
	@mkdir -p .cache
	@$(PROBE) node scripts/check-content.mjs
export-static:
	@mkdir -p .cache ../images
	@$(PROBE) node scripts/export-static.mjs
check-static:
	@$(PROBE) node scripts/check-static.mjs
validate: check-source check-geometry check-convergence check-browser check-performance check-content check-static
deliver:
	@$(NODE) node --input-type=module -e 'import {copyFileSync} from "node:fs"; import {portableName} from "./scripts/portable-path.mjs"; copyFileSync("dist/"+portableName, "../"+portableName);'
checksums:
	@$(NODE) node scripts/checksums.mjs
.PHONY: check-r11
check-r11: PROBE_MOUNTS = -v "$(R11_SHOTS_DIR):/r11-shots"
check-r11:
	@mkdir -p "$(R11_SHOTS_DIR)"
	@$(PROBE) node scripts/check-r11.mjs

R11_FINAL_SHOTS_DIR ?= $(CURDIR)/.cache/r11-final-shots
.PHONY: check-r11-final
check-r11-final: PROBE_MOUNTS = -v "$(R11_FINAL_SHOTS_DIR):/r11-final-shots"
check-r11-final:
	@mkdir -p "$(R11_FINAL_SHOTS_DIR)"
	@$(PROBE) node scripts/check-r11-final.mjs
