# SPEC_VOL — @sentropic/chat-core

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Extraire l'orchestration d'une session chat (tool loop, reasoning loop, continuation, cancellation, retry, checkpoints, message lifecycle, trace events, stream replay) de l'app Sentropic monolithique en une lib npm publiable agnostique du provider. Base réutilisable par tout agent runtime conversationnel : app web, CLI custom bâti sur `@sentropic/harness`, extension VSCode. Délègue providers à `@sentropic/llm-mesh`, workflow multi-étape à `@sentropic/flow`, persistence à adapters via ports `CheckpointStore<ChatState>` / `MessageStore` / `StreamBuffer` / `LiveDocumentStore`.

## Non-goal

Pas de provider access direct (réservé à mesh). Pas d'UI (réservé à chat-ui). Pas de workflow multi-étape (réservé à flow). Pas de gestion de credentials. Pas de marketplace. Pas de durable execution multi-jour (réservé à flow + persistence durable).
