# Standalone read-only collectors. No repository Makefile or .env is loaded.
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
W0_KUBECONFIG ?= /home/antoinefa/.kube/config
W0_NS ?= sentropic
W0_BACKUPS ?= /home/antoinefa/src/sentropic/data/backup
W0_DUMP ?= prod-2026-10-17T21-56-20.dump
W0_PG := postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
W0_KUBE = kubectl --kubeconfig="$(W0_KUBECONFIG)" --request-timeout=15s -n "$(W0_NS)"
W0_DIR := docs/baselines/app-cm-w0
.PHONY: w0-roles w0-config w0-backup-status w0-archive w0-ci-recovery w0-local-restore w0-access
w0-roles:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@$(W0_KUBE) get deployments -o json | jq -c '{items:[.items[]|{name:.metadata.name,uid:.metadata.uid,resourceVersion:.metadata.resourceVersion,generation:.metadata.generation,revision:.metadata.annotations["deployment.kubernetes.io/revision"],replicas:.spec.replicas,containers:[.spec.template.spec.containers[]|{name,image}]}]}'
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@$(W0_KUBE) get pods -o json | jq -c '{count:(.items|length),items:[.items[]|{name:.metadata.name,uid:.metadata.uid,startTime:.status.startTime,containers:[.status.containerStatuses[]?|{name,imageID,ready,restartCount}]}]}'
w0-config:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@$(W0_KUBE) get configmaps -o json | jq -c '.items[]' | while IFS= read -r item; do \
	  printf '%s' "$$item" | jq -c '{name:.metadata.name,uid:.metadata.uid,resourceVersion:.metadata.resourceVersion}'; \
	  printf '%s' "$$item" | jq -Sc '{data,binaryData,immutable}' | sha256sum; \
	done
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@$(W0_KUBE) get deployments -o json | jq -c '.items[]' | while IFS= read -r item; do \
	  printf '%s' "$$item" | jq -c '{name:.metadata.name,resourceVersion:.metadata.resourceVersion,refs:[.spec.template.spec.containers[]|{name,envFrom:.envFrom,refs:[.env[]?|select(.valueFrom)|{name,valueFrom}]}]}'; \
	  printf '%s' "$$item" | jq -Sc '.spec.template' | sha256sum; \
	done
w0-backup-status:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@$(W0_KUBE) get cronjobs,jobs -o json | jq -c '{items:[.items[]|{kind,name:.metadata.name,uid:.metadata.uid,resourceVersion:.metadata.resourceVersion,schedule:.spec.schedule,suspend:.spec.suspend,lastSuccessfulTime:.status.lastSuccessfulTime,startTime:.status.startTime,completionTime:.status.completionTime,succeeded:.status.succeeded,failed:.status.failed,conditions:[.status.conditions[]?|{type,status}]}]}'
w0-archive:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@stat -c '%n %s bytes mtime=%y' "$(W0_BACKUPS)/$(W0_DUMP)"
	@sha256sum "$(W0_BACKUPS)/$(W0_DUMP)"
	@docker run --rm --read-only --network none -v "$(W0_BACKUPS):/snapshots:ro" --entrypoint pg_restore $(W0_PG) --list "/snapshots/$(W0_DUMP)" | awk '/^; (Archive created|[[:space:]]*dbname:|[[:space:]]*TOC Entries:|[[:space:]]*Dump Version:|[[:space:]]*Format:|[[:space:]]*Dumped from database version:|[[:space:]]*Dumped by pg_dump version:)/ || /TABLE DATA.*(context_document|job_queue|chat_messages|__drizzle|artifact)/ {print}'
	@docker run --rm --read-only --network none -v "$(W0_BACKUPS):/snapshots:ro" --entrypoint pg_restore $(W0_PG) --data-only --table=context_documents --table=context_document_versions --table=job_queue --table=chat_messages --table=__drizzle_migrations --table=__drizzle_control_migrations --file=- "/snapshots/$(W0_DUMP)" | awk -f $(W0_DIR)/archive-inventory.awk | sort
w0-ci-recovery:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@gh api 'repos/rhanka/sentropic/actions/runs/39154603798/jobs?per_page=100' --jq '{total_count,jobs:[.jobs[]|select(.name|test("deploy|preprod|restore|backup"))|{id,name,conclusion,started_at,completed_at,steps:[.steps[]|select(.name|test("[Dd]eploy|[Rr]estore|[Bb]ackup|[Mm]igrat"))|{name,conclusion,started_at,completed_at}]}]}'
w0-local-restore:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@for file in preprod-pre-0008.source-exact.clean.txt preprod-pre-0008.restored-exact.clean.txt; do \
	  stat -c '%n %s bytes mtime=%y' "$(W0_BACKUPS)/$$file"; sha256sum "$(W0_BACKUPS)/$$file"; \
	  awk '/context_documents|context_document_versions|job_queue|chat_messages|__drizzle/ {print}' "$(W0_BACKUPS)/$$file"; \
	done
w0-access:
	@date -u +%Y-%m-%dT%H:%M:%SZ
	@kubectl --kubeconfig="$(W0_KUBECONFIG)" config get-contexts
	@$(W0_KUBE) get ingress -o='jsonpath={range .items[*]}{.metadata.name}{"\t"}{range .spec.rules[*]}{.host}{";"}{end}{"\t"}{.status.loadBalancer.ingress}{"\n"}{end}'
	@getent ahostsv4 sentropic.sent-tech.ca
	@for name in KUBECONFIG PGHOST PGPORT PGUSER PGDATABASE PGPASSFILE PGSERVICE PGSERVICEFILE DATABASE_URL; do if [[ -v "$$name" ]]; then printf '%s=set\n' "$$name"; else printf '%s=unset\n' "$$name"; fi; done
	@for file in /home/antoinefa/.pg_service.conf /home/antoinefa/.pgpass; do if [[ -f "$$file" ]]; then printf '%s=present\n' "$$file"; else printf '%s=absent\n' "$$file"; fi; done
