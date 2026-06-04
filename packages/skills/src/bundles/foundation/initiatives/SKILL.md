---
name: initiatives
description: Read and update initiatives, including the legacy read/update initiative tools.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: initiatives_list
    description: List initiatives in the current workspace with status and maturity metadata.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Optional folder filter.
        status:
          type: string
          description: Optional status filter.
  - name: read_initiative
    description: Read one initiative by id with its structured fields.
    inputSchema:
      type: object
      properties:
        initiativeId:
          type: string
          description: Initiative identifier.
      required: [initiativeId]
  - name: update_initiative
    description: Update editable initiative fields after caller approval and authorization.
    inputSchema:
      type: object
      properties:
        initiativeId:
          type: string
        patch:
          type: object
          additionalProperties: true
      required: [initiativeId, patch]
    sideEffect: true
    requiresApproval: true
---

# Initiatives skill

The `initiatives` skill exposes workspace-scoped initiative object tools. It
keeps the legacy tool names `read_initiative` and `update_initiative` for the
current migration step while grouping them under the object skill metadata.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
