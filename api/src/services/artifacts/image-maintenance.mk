# Offline only: caller fences/stops writers and runs this make under docker-slot.sh.
.PHONY: artifact-image-rollback artifact-image-resume
artifact-image-rollback artifact-image-resume: artifact-image-%: api/src/services/artifacts/image-%.sql
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres \
		psql --set ON_ERROR_STOP=on -U app -d app -f - < "$<"
