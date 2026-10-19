# SQLite L3a qualification targets (lot 1). Source tooling delegates to the
# root Makefile's disposable workspace; no pg container is required.
.PHONY: cluster-mesh-sqlite-test
cluster-mesh-sqlite-test:
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-run SCOPE="$(if $(SCOPE),$(SCOPE),tests/storage/sqlite-)" ENV=$(ENV)

.PHONY: cluster-mesh-sqlite-run
cluster-mesh-sqlite-run:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'SQLite qualification requires test-* or e2e-*'; exit 1;; esac
	@$(MAKE) cluster-mesh-workspace CM_ACTION=test SCOPE="$(SCOPE)" ENV=$(ENV)
