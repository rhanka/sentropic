include .tmp/live-stt/l1/verify.mk

L1_TUPLE_RUN = $(L1_COMPOSE) run --rm --no-deps -T -u $(shell id -u):$(shell id -g) -e CM_PEER_TOOLS="$(CLUSTER_MESH_PEER_TOOLS)" -e MANIFEST_HEAD_SHA=$(shell git rev-parse HEAD) -e L1_ALIGN=$(L1_ALIGN) -v $(CURDIR):/source qualification

.PHONY: test-l1-packed-tuple
test-l1-packed-tuple:
	$(L1_TUPLE_RUN) sh -ec 'sed '\''/^case /,$$d'\'' /source/packages/cluster-mesh/tests/storage/cold-workspace.sh > /tmp/l1-cold.sh; cat /source/.tmp/live-stt/l1/tuple-tail.sh >> /tmp/l1-cold.sh; sh /tmp/l1-cold.sh'
