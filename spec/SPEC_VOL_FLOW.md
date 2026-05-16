# SPEC_VOL — @sentropic/flow

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Extraire le workflow runtime existant (`api/src/services/todo-orchestration.ts`, `queue-manager.ts`, `default-workflows.ts`, transitions typées `start/normal/conditional/fanout/join/end`, gates humaines, agent templating `promptTemplate` + `agentSelection`) en une lib npm publiable durable, **sans réécriture**, pour rendre les workflows agentiques multi-étape / multi-agent / multi-jour réutilisables hors de l'app Sentropic. Préserve l'agent templating comme invariant migration. Exposes ports `CheckpointStore<FlowState>` (strict OCC) + `JobQueue` (lease/heartbeat/DLQ/idempotency) + `WorkflowStore` + `ApprovalGate`.

## Non-goal

Pas de réécriture from scratch (façade-first + golden traces obligatoires). Pas d'orchestration de session chat (réservé à chat-core). Pas de provider access direct. Pas de marketplace. Pas de réinvention d'un moteur Temporal/LangGraph.
