ROOT := $(abspath ../../../..)
ENV ?= feat-v8-spike
IMAGE := mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948
TOOLS := $(ENV)-v8-tools

.PHONY: prepare fixtures bundle probe
prepare:
	@test "$$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 30
	docker run --rm -v $(TOOLS):/tools -w /tools $(IMAGE) npm install --ignore-scripts --no-audit --no-fund --save-exact @vue/compiler-sfc@3.6.0-rc.15 @vue/compiler-vapor@3.6.0-rc.15 vue@3.6.0-rc.15 sucrase@3.35.1 esbuild@0.25.12 isolated-vm@6.1.2 gray-matter@4.0.3 zod@4.6.7

fixtures:
	docker run --rm -u "$$(id -u):$$(id -g)" -v $(ROOT):/repo -w /repo/packages/cluster-mesh/tests/compile-spike $(IMAGE) node fixtures.mjs --write

bundle:
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) sh -ec 'mkdir -p spike; cp /repo/packages/cluster-mesh/tests/compile-spike/*.mjs spike/; ./node_modules/.bin/esbuild spike/bootstrap.mjs --bundle --format=iife --platform=browser --outfile=spike/bootstrap.js; node -e '\''const s=require("fs").readFileSync("spike/bootstrap.js","utf8");new Function(s);console.log("bootstrap",Buffer.byteLength(s),require("crypto").createHash("sha256").update(s).digest("hex"))'\'''

probe:
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) node spike/compiler-probe.mjs
