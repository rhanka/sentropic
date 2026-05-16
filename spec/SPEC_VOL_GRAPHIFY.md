# SPEC_VOL — @sentropic/graphify

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Fusionner le package npm `graphifyy@0.7.10` (existant, maintenu par l'utilisateur — "AI coding assistant skill cross-CLI : Claude Code, Codex, Gemini CLI, Kimi Code, GitHub Copilot CLI, Aider, OpenCode, OpenClaw — turn any folder of code/docs/papers/images/audio-video transcripts into a queryable knowledge graph") sous le namespace `@sentropic/graphify`. Conserve le binaire CLI `graphify`, l'export ESM + CJS, et la skill format compatible cross-CLI. Consommé directement par `@sentropic/harness` (commande `harness graph`) et invocable en standalone par tout dev/CLI. Stratégie de fusion à arbitrer en BR-graphify : transfert npm registry vs nouvelle publication parallèle avec deprecate de `graphifyy`.

## Non-goal

Pas de réinvention from scratch des features graphifyy (clustering, god-nodes, BFS/DFS query, HTML+JSON+audit publication). Pas d'absorption dans `@sentropic/harness` (graphify reste consommable en standalone). Pas d'extension du scope graphify aux usages chat-core / flow runtime (reste un outil dev/exploration).
