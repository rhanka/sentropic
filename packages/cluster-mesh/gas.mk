# N4 GAS release assets (package-local, Docker only, no Makefile edit). Run from the repository root:
#   make -f Makefile -f packages/cluster-mesh/gas.mk release-cluster-mesh-gas-dry-run ENV=<env>
# Targets: build-cluster-mesh-gas (bundle, sha256, manifest; builds twice and compares), sbom-cluster-mesh-gas (syft
# from scripts/security/scanner/tool-inventory.json, digest-verified), verify-cluster-mesh-gas (bundle sha256 = release sha256).
GAS_NODE_IMAGE ?= node:24-bookworm-slim
GAS_OUT ?= tmp/gas-release
GAS_GIT_SHA ?= $(shell git rev-parse HEAD)
GAS_EXPECT_SHA ?=
# esbuild comes from the committed tool-lock entry shared with the cluster-mesh cold workspace (same spec list => same lock).
GAS_LOCKED_TOOLS = typescript@5.4.5 @types/node vitest@4.1.5 pg@8.16.3 @stablelib/sha256@2.0.1 @modelcontextprotocol/sdk@1.31.0 @aws-sdk/client-s3@3.1095.0 @aws-sdk/s3-request-presigner@3.1095.0 @types/pg@8.20.0 esbuild@0.25.12 @simplewebauthn/browser@13.3.0 $(CLUSTER_MESH_PEER_TOOLS)
GAS_RUN = docker run --rm --init -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -e GAS_GIT_SHA="$(GAS_GIT_SHA)" \
	-v "$(CURDIR):/source:ro" -v "$(CURDIR)/$(GAS_OUT):/out" -w /source $(GAS_NODE_IMAGE)

.PHONY: build-cluster-mesh-gas sbom-cluster-mesh-gas verify-cluster-mesh-gas release-cluster-mesh-gas-dry-run
build-cluster-mesh-gas: ## Build the deterministic GAS bundle + sha256 + manifest into $(GAS_OUT)
	@test -n "$(GAS_GIT_SHA)"
	@mkdir -p "$(GAS_OUT)"
	@$(GAS_RUN) sh -ec 'mkdir -p /tmp/t /tmp/ws; node scripts/ci/locked-tools.mjs --prefix /tmp/t --no-save --ignore-scripts --no-audit --no-fund --install-strategy=shallow $(GAS_LOCKED_TOOLS) >/dev/null; \
		cp -R packages/cluster-mesh/src packages/cluster-mesh/scripts packages/cluster-mesh/package.json /tmp/ws/; ln -s /tmp/t/node_modules /tmp/ws/node_modules; \
		node /tmp/ws/scripts/gas-release.mjs build /out'

sbom-cluster-mesh-gas: ## CycloneDX SBOM of the release directory with the admitted syft
	@mkdir -p "$(GAS_OUT)"
	@$(GAS_RUN) sh -ec 'mkdir -p /tmp/syft; node packages/cluster-mesh/scripts/gas-release.mjs fetch-syft /tmp/syft /source/scripts/security/scanner/tool-inventory.json >/dev/null; \
		tar -xzf /tmp/syft/syft.tar.gz -C /tmp/syft syft; cd /out; \
		SYFT_CHECK_FOR_APP_UPDATE=false /tmp/syft/syft dir:/out --source-name cluster-mesh-gas --source-version "$(GAS_GIT_SHA)" -o cyclonedx-json=/out/cluster-mesh.gas.sbom.cdx.json'

verify-cluster-mesh-gas: ## Check bundle sha256 = .sha256 = manifest (= GAS_EXPECT_SHA when given)
	@$(GAS_RUN) node packages/cluster-mesh/scripts/gas-release.mjs verify /out --require-sbom $(if $(GAS_EXPECT_SHA),--expect-sha=$(GAS_EXPECT_SHA))

release-cluster-mesh-gas-dry-run: build-cluster-mesh-gas sbom-cluster-mesh-gas verify-cluster-mesh-gas ## Full dry run; publishes nothing
