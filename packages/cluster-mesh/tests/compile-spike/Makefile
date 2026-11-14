ROOT := $(abspath ../../../..)
COMMON_DIR := $(shell git rev-parse --path-format=absolute --git-common-dir)
KUBECONFIG ?= $(abspath $(COMMON_DIR)/../.tmp/a4-private/tenant-kubeconfig)
export KUBECONFIG
ENV ?= feat-v8-spike
IMAGE := mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948
TOOLS := $(ENV)-v8-tools
POD_SPEC ?= pod.yaml
SPIKE_SINGLE ?= 0
RESULT_NAME ?= isolate-results

.PHONY: prepare fixtures bundle probe adapter adapter-negative cancel closure export pod-start pod-run pod-results pod-delete
prepare:
	$(MAKE) -C $(ROOT)/e2e/tests/harness prepare ENV=$(ENV)

fixtures:
	docker run --rm -u "$$(id -u):$$(id -g)" -v $(ROOT):/repo -w /repo/packages/cluster-mesh/tests/compile-spike $(IMAGE) node fixtures.mjs --write

bundle:
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) sh -ec 'mkdir -p spike; cp /repo/packages/cluster-mesh/tests/compile-spike/*.mjs spike/; ./node_modules/.bin/esbuild spike/bootstrap.mjs --bundle --format=iife --platform=browser --outfile=spike/bootstrap.js; node -e '\''const s=require("fs").readFileSync("spike/bootstrap.js","utf8");new Function(s);console.log("bootstrap",Buffer.byteLength(s),require("crypto").createHash("sha256").update(s).digest("hex"))'\'''

probe: bundle
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) node spike/compiler-probe.mjs

adapter: bundle
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) sh -ec './node_modules/.bin/esbuild /repo/packages/skills/tests/sandbox/v8-spike.mjs --bundle --platform=node --format=esm --external:isolated-vm --external:docx --external:pptxgenjs --outfile=spike/adapter.mjs; node spike/adapter.mjs'

adapter-negative: adapter
	docker run --rm -v $(TOOLS):/tools -v $(ROOT):/repo:ro -w /tools $(IMAGE) sh -ec 'if SPIKE_FORCE_FAILURE=1 SPIKE_RECEIPT=/tools/spike/adapter-negative.json node spike/adapter.mjs; then exit 1; fi; node -e '\''const r=require("./spike/adapter-negative.json");if(r.length!==3||r.some(x=>x.ok||x.errorCode!=="SANDBOX_THROW"))process.exit(1)'\'''

cancel: bundle
	docker run --rm -v $(TOOLS):/tools -w /tools $(IMAGE) node spike/cancel-probe.mjs

closure: bundle
	docker run --rm -v $(TOOLS):/tools -w /tools $(IMAGE) node spike/closure.mjs

export: probe adapter-negative cancel closure
	@mkdir -p results
	docker run --rm -u "$$(id -u):$$(id -g)" -v $(TOOLS):/tools:ro -v $(CURDIR)/results:/results $(IMAGE) cp /tools/spike/bootstrap.js /tools/spike/compiler-probe.json /tools/spike/adapter.json /tools/spike/adapter-negative.json /tools/spike/cancel.json /tools/spike/closure.json /results/

pod-start:
	kubectl apply -f $(POD_SPEC)
	kubectl wait --for=condition=Ready pod/v8-vd-2-0-spike -n sentropic-preprod --timeout=60s
	kubectl exec -n sentropic-preprod v8-vd-2-0-spike -- mkdir -p /tmp/spike
	kubectl cp results/bootstrap.js sentropic-preprod/v8-vd-2-0-spike:/tmp/spike/bootstrap.js
	kubectl cp fixtures.mjs sentropic-preprod/v8-vd-2-0-spike:/tmp/spike/fixtures.mjs
	kubectl cp isolate-bench.mjs sentropic-preprod/v8-vd-2-0-spike:/tmp/spike/isolate-bench.mjs

pod-run:
	kubectl exec -n sentropic-preprod v8-vd-2-0-spike -- env SPIKE_SINGLE=$(SPIKE_SINGLE) node /tmp/spike/isolate-bench.mjs

pod-results:
	kubectl cp sentropic-preprod/v8-vd-2-0-spike:/tmp/spike/isolate-results.json results/$(RESULT_NAME).json

pod-delete:
	kubectl delete pod v8-vd-2-0-spike -n sentropic-preprod --ignore-not-found --wait=false
