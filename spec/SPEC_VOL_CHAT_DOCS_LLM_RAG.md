# SPEC_VOL — Chat × Workspace, Document Connectors, LLM Providers, RAG

> Ephemeral: to be absorbed into SPEC_EVOL files, then deleted.
> Date: 2026-03-12

## Demand 1 — Workspace × Chat × Tools coupling

> "On n'a pas mentionné l'impact workspace / outils pour le chat. ça justifierais encore un truc avant le 05 pour de vrai."

- BR-04 introduit les workspace types mais n'a pas spécifié l'impact sur le chat et les tools.
- Aujourd'hui les tools sont scopés par `contextType` (organization, folder, usecase, executive_summary) — pas par workspace type.
- Avec les workspace types, le tool set doit varier : un workspace `opportunity` a besoin de tools bid/solution, un `code` de tools code analysis, un `ai-ideas` des tools actuels.
- Le tool registry doit devenir workspace-type-aware.
- Impact sur `chat-service.ts` (`buildChatGenerationContext`), `tools.ts`, `chat-tool-scope.ts`.

## Demand 2 — ChatPanel/ChatWidget modularisation

> "Mon objectif est très simple. Je voudrais pouvoir paralléliser d'autres branches, notamment refactorer / modulariser Chatpanel et Chatwidget."

- ChatPanel.svelte (59K) et ChatWidget.svelte (37K) sont des monolithes.
- Objectif : refactorer en composants modulaires pour permettre le travail en parallèle sur d'autres branches.
- Doit être une branche séparée, mais BR-04 doit définir les boundaries pour éviter les conflits.
- Le lien workspace × chat × tools doit être clarifié dans BR-04 pour que la modularisation puisse se faire sans dépendance forte.

## Demand 3 — Connecteurs documentaires (Google Workspace, SharePoint)

> "Je voudrais aussi pouvoir ajouter d'autres connecteurs documentaires comme google workspace et sharepoint."

- Aujourd'hui : upload fichier local uniquement (S3-compatible storage).
- Cible : connecteurs Google Workspace (Drive, Docs, Sheets) et SharePoint/OneDrive.
- Impact sur le modèle document : `contextDocuments` doit supporter un `connector_type` (local, google_drive, sharepoint) + `external_ref` (URL/ID externe).
- Impact sur les liens doc-objet : les documents s'attachent aux contextes (organization, folder, usecase/initiative). Avec BR-04 rename en `initiatives`, les contextType refs changent.
- Impact sur le chat : les documents connectés doivent être accessibles par le `documents` tool comme les locaux.

## Demand 4 — Connecteurs LLM supplémentaires

> "Je voudrais aussi démultiplier les connecteurs llm (ajouter claude, mistral, cohere)"

- Aujourd'hui : OpenAI + Gemini (BR-01 delivered).
- Cible : ajouter Claude (Anthropic), Mistral, Cohere.
- Claude + Mistral déjà prévus dans BR-08 (SPEC_EVOL_MODEL_AUTH_PROVIDERS §4.2 W2).
- Cohere est nouveau, pas encore dans le roadmap.
- Le ProviderRuntime interface est déjà prêt pour de nouveaux providers.

## Demand 5 — RAG sur dossiers documentaires

> "et ajouter du RAG sur les dossiers documentaires"

- Aujourd'hui : pas de vector embeddings, pas de semantic search. Les documents sont résumés par LLM et le résumé est passé en contexte.
- Cible : RAG (Retrieval-Augmented Generation) sur les documents attachés à un contexte (folder, organization).
- Implique : chunking des documents, embeddings vectoriels, vector store (pgvector ou externe), retrieval pipeline avant injection dans le prompt LLM.
- Impact sur le chat : le tool `documents` passe de "list/search" à "semantic retrieval" avec scoring de pertinence.
- Impact sur le modèle : `contextDocuments` doit stocker les chunks + embeddings (ou table séparée `document_chunks`).

## Demand 6 — Articulation avec BR-04

> "du coup il me semblerait cohérent de mettre ça comme SPEC_VOL séparée, et que tu adaptes les SPEC_EVOL pour border cette branche et lui permettre d'être bien articulée avec les autres."

- BR-04 doit PREPARER les extension points sans IMPLEMENTER ces features.
- Les branches futures doivent pouvoir travailler en parallèle sans conflits avec BR-04.
- Les SPEC_EVOL doivent être mis à jour pour tracer les boundaries.
