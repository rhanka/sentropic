# Official cold package gates; no host dependency tree or device access.
LIVE_SPEECH_COMPOSE = docker compose -p $(ENV) -f docker-compose.immo-861.yml
.PHONY: test-live-speech typecheck-live-speech lint-live-speech build-live-speech live-speech-down
test-live-speech typecheck-live-speech lint-live-speech build-live-speech:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'A dedicated test ENV is required'; exit 1;; esac
	@trap '$(MAKE) -f packages/live-speech/verify.mk live-speech-down ENV=$(ENV)' EXIT; \
	  $(LIVE_SPEECH_COMPOSE) run --rm --no-deps -T -u "$$(id -u):$$(id -g)" qualification sh packages/live-speech/verify.sh "$@" "$(SCOPE)"
live-speech-down:
	@case "$(ENV)" in test-*|e2e-*) ;; *) exit 1;; esac
	@$(LIVE_SPEECH_COMPOSE) down --volumes --remove-orphans
