GB4_IMAGE := docker.io/library/node@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
.PHONY: gb4-env gb4-prepare gb4-run gb4-wait gb4-check
gb4-env:
	@case "$(ENV)" in test-*) ;; *) echo 'ENV=test-* required'; exit 2 ;; esac
gb4-prepare: gb4-env
	@node deploy/ci/gb4-probe/run.mjs --prepare
gb4-run: gb4-env
	@node deploy/ci/gb4-probe/run.mjs --run
gb4-wait: gb4-env
	@node deploy/ci/gb4-probe/run.mjs --wait
gb4-check: gb4-env
	@docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
	  --tmpfs /tmp:uid=1000,gid=1000 --tmpfs /home/node/app/node_modules:uid=1000,gid=1000 \
	  --tmpfs /home/node/app/.vite:uid=1000,gid=1000 --tmpfs /home/node/.npm:uid=1000,gid=1000 \
	  -v "$(CURDIR):/workspace:ro" -w /workspace $(GB4_IMAGE) node --test deploy/ci/gb4-probe/probe.test.mjs
