---
name: documents
description: Access documents attached to a context (organization, folder, initiative, chat session) with list, summary, content, and analyze actions.
version: 0.1.0
category: content
tools:
  - name: documents
    description: |
      Accède aux documents attachés à un contexte (organization/folder/usecase/chat_session).

      Les documents sont fournis par l'utilisateurs et supposés être une source importante d'information.

      Permet de:
       - lister les documents + statuts,
       - lire un RÉSUMÉ COURT (get_summary) pour une information de surface,
       - lire le CONTENU (get_content) : soit le text complet (petit doc) soit un résumé (10k mots si le document est long) - pour une information détaillée
       - lancer une analyse ciblée (analyze) - pour une requête ciblée (recherche d'un contenu).
    inputSchema:
      type: object
      properties:
        action:
          type: string
          enum: [list, get_summary, get_content, analyze]
          description: Action à effectuer.
        contextType:
          type: string
          enum: [organization, folder, initiative, chat_session]
          description: Type du contexte.
        contextId:
          type: string
          description: ID du contexte.
        documentId:
          type: string
          description: ID du document (requis pour get_summary/get_content).
        maxChars:
          type: number
          description: 'Optionnel: borne de caractères pour get_content (max 50000).'
        prompt:
          type: string
          description: "Requis pour analyze: prompt/instruction ciblée à exécuter par un sous-agent à partir du document (texte intégral si possible; sinon scan complet par extraits + consolidation)."
        maxWords:
          type: number
          description: 'Optionnel: borne en mots pour analyze (max 10000, défaut 10000).'
      required: [action, contextType, contextId]
---

# Documents skill

The `documents` skill exposes attachments stored under a workspace context
(organization, folder, initiative, or chat session). It supports four actions:
list documents and statuses, fetch a short summary, fetch bounded content, or
run a targeted sub-agent analysis over the document.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
