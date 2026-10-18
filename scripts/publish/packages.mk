# BR-EX1: reusable library builds live entirely in disposable containers.
PUBLIC_LIBRARY_SLUGS := ubo-contracts mcp-broker connector-host mcp-connector-airtable mcp-connector-dropbox mcp-connector-github mcp-connector-gmail mcp-connector-google mcp-connector-googlecalendar mcp-connector-googledocs mcp-connector-googledrive mcp-connector-googlesheets mcp-connector-hubspot mcp-connector-linear mcp-connector-notion mcp-connector-slack mcp-connector-stripe skills
PUBLIC_LIBRARY_IMAGE ?= node:24-bookworm

# CI-only steady-state publishing: the same exact-artifact guard as existing lanes.
define publish_public_library
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS -e GITHUB_REPOSITORY -e GITHUB_REF -e GITHUB_SHA -e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -e GITHUB_SERVER_URL -e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID -e GITHUB_WORKFLOW -e GITHUB_WORKFLOW_REF -e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL -e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" -w /workspace/packages/$(1) $(MANIFEST_GUARD_IMAGE) \
		sh -lc 'set -eu; $(call manifest_guard_publish,$(1),--access public --provenance)'
endef

.PHONY: build-public-libraries test-public-libraries build-public-library test-public-library lock-public-libraries
build-public-libraries test-public-libraries:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" -w /workspace $(PUBLIC_LIBRARY_IMAGE) \
		node scripts/publish/build-library.mjs $(if $(filter build-public-libraries,$@),build,test)

build-public-library test-public-library:
	@case " $(PUBLIC_LIBRARY_SLUGS) " in *" $(PACKAGE) "*) test -n "$(PACKAGE)" ;; *) echo "Unknown public library"; exit 1 ;; esac
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" -w /workspace $(PUBLIC_LIBRARY_IMAGE) \
		node scripts/publish/build-library.mjs $(if $(filter build-public-library,$@),build,test) "$(PACKAGE)"

lock-public-libraries:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" -w /workspace $(PUBLIC_LIBRARY_IMAGE) \
		npm install --package-lock-only --ignore-scripts --no-audit --no-fund

.PHONY: pack-ubo-contracts publish-ubo-contracts
pack-ubo-contracts:
	@$(MAKE) build-public-library PACKAGE=ubo-contracts ENV=$(ENV)
	$(call manifest_guard_pack,ubo-contracts)
publish-ubo-contracts:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=ubo-contracts ENV=$(ENV)
	$(call publish_public_library,ubo-contracts)

.PHONY: pack-mcp-broker publish-mcp-broker
pack-mcp-broker:
	@$(MAKE) build-public-library PACKAGE=mcp-broker ENV=$(ENV)
	$(call manifest_guard_pack,mcp-broker)
publish-mcp-broker:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-broker ENV=$(ENV)
	$(call publish_public_library,mcp-broker)

.PHONY: pack-connector-host publish-connector-host
pack-connector-host:
	@$(MAKE) build-public-library PACKAGE=connector-host ENV=$(ENV)
	$(call manifest_guard_pack,connector-host)
publish-connector-host:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=connector-host ENV=$(ENV)
	$(call publish_public_library,connector-host)

.PHONY: pack-mcp-connector-airtable publish-mcp-connector-airtable
pack-mcp-connector-airtable:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-airtable ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-airtable)
publish-mcp-connector-airtable:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-airtable ENV=$(ENV)
	$(call publish_public_library,mcp-connector-airtable)

.PHONY: pack-mcp-connector-dropbox publish-mcp-connector-dropbox
pack-mcp-connector-dropbox:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-dropbox ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-dropbox)
publish-mcp-connector-dropbox:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-dropbox ENV=$(ENV)
	$(call publish_public_library,mcp-connector-dropbox)

.PHONY: pack-mcp-connector-github publish-mcp-connector-github
pack-mcp-connector-github:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-github ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-github)
publish-mcp-connector-github:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-github ENV=$(ENV)
	$(call publish_public_library,mcp-connector-github)

.PHONY: pack-mcp-connector-gmail publish-mcp-connector-gmail
pack-mcp-connector-gmail:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-gmail ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-gmail)
publish-mcp-connector-gmail:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-gmail ENV=$(ENV)
	$(call publish_public_library,mcp-connector-gmail)

.PHONY: pack-mcp-connector-google publish-mcp-connector-google
pack-mcp-connector-google:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-google ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-google)
publish-mcp-connector-google:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-google ENV=$(ENV)
	$(call publish_public_library,mcp-connector-google)

.PHONY: pack-mcp-connector-googlecalendar publish-mcp-connector-googlecalendar
pack-mcp-connector-googlecalendar:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googlecalendar ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-googlecalendar)
publish-mcp-connector-googlecalendar:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googlecalendar ENV=$(ENV)
	$(call publish_public_library,mcp-connector-googlecalendar)

.PHONY: pack-mcp-connector-googledocs publish-mcp-connector-googledocs
pack-mcp-connector-googledocs:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googledocs ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-googledocs)
publish-mcp-connector-googledocs:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googledocs ENV=$(ENV)
	$(call publish_public_library,mcp-connector-googledocs)

.PHONY: pack-mcp-connector-googledrive publish-mcp-connector-googledrive
pack-mcp-connector-googledrive:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googledrive ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-googledrive)
publish-mcp-connector-googledrive:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googledrive ENV=$(ENV)
	$(call publish_public_library,mcp-connector-googledrive)

.PHONY: pack-mcp-connector-googlesheets publish-mcp-connector-googlesheets
pack-mcp-connector-googlesheets:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googlesheets ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-googlesheets)
publish-mcp-connector-googlesheets:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-googlesheets ENV=$(ENV)
	$(call publish_public_library,mcp-connector-googlesheets)

.PHONY: pack-mcp-connector-hubspot publish-mcp-connector-hubspot
pack-mcp-connector-hubspot:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-hubspot ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-hubspot)
publish-mcp-connector-hubspot:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-hubspot ENV=$(ENV)
	$(call publish_public_library,mcp-connector-hubspot)

.PHONY: pack-mcp-connector-linear publish-mcp-connector-linear
pack-mcp-connector-linear:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-linear ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-linear)
publish-mcp-connector-linear:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-linear ENV=$(ENV)
	$(call publish_public_library,mcp-connector-linear)

.PHONY: pack-mcp-connector-notion publish-mcp-connector-notion
pack-mcp-connector-notion:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-notion ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-notion)
publish-mcp-connector-notion:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-notion ENV=$(ENV)
	$(call publish_public_library,mcp-connector-notion)

.PHONY: pack-mcp-connector-slack publish-mcp-connector-slack
pack-mcp-connector-slack:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-slack ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-slack)
publish-mcp-connector-slack:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-slack ENV=$(ENV)
	$(call publish_public_library,mcp-connector-slack)

.PHONY: pack-mcp-connector-stripe publish-mcp-connector-stripe
pack-mcp-connector-stripe:
	@$(MAKE) build-public-library PACKAGE=mcp-connector-stripe ENV=$(ENV)
	$(call manifest_guard_pack,mcp-connector-stripe)
publish-mcp-connector-stripe:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=mcp-connector-stripe ENV=$(ENV)
	$(call publish_public_library,mcp-connector-stripe)

.PHONY: pack-skills publish-skills
pack-skills:
	@$(MAKE) build-public-library PACKAGE=skills ENV=$(ENV)
	$(call manifest_guard_pack,skills)
publish-skills:
	@test "$(GITHUB_ACTIONS)" = true && test "$(GITHUB_REF)" = refs/heads/main || { echo "CI trusted publishing only; first publication uses npm-bootstrap-web"; exit 1; }
	@$(MAKE) build-public-library PACKAGE=skills ENV=$(ENV)
	$(call publish_public_library,skills)
