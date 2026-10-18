# BR-EX1: reusable library builds live entirely in disposable containers.
PUBLIC_LIBRARY_SLUGS := ubo-contracts mcp-broker connector-host mcp-connector-airtable mcp-connector-dropbox mcp-connector-github mcp-connector-gmail mcp-connector-google mcp-connector-googlecalendar mcp-connector-googledocs mcp-connector-googledrive mcp-connector-googlesheets mcp-connector-hubspot mcp-connector-linear mcp-connector-notion mcp-connector-slack mcp-connector-stripe skills
PUBLIC_LIBRARY_IMAGE ?= node:24-bookworm

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
