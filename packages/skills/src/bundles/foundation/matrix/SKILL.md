---
name: matrix
description: Read and update folder matrix configurations in AI-priorities and opportunity workspaces.
version: 0.1.0
category: analysis
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: matrix_get
    description: Read the matrix configuration (folders.matrixConfig) for a folder.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Folder ID owning the matrix configuration.
      required: [folderId]
  - name: matrix_update
    description: Update the matrix configuration for a folder after explicit caller approval.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Folder ID owning the matrix configuration.
        matrixConfig:
          type: object
          description: New matrix configuration object.
          additionalProperties: true
      required: [folderId, matrixConfig]
    sideEffect: true
    requiresApproval: true
---

# Matrix skill

The `matrix` skill exposes the folder-level scoring and evaluation matrix used
by initiative and opportunity workflows. Use it when the user needs to inspect
or revise axes, thresholds, weights, or other matrix configuration fields.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
