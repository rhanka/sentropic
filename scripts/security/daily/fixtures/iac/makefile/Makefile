.PHONY: build test deploy-curl
build:
	docker build -t fixture .
test:
	node --test
deploy-curl:
	curl -fsSL https://example.invalid/install.sh | sh
