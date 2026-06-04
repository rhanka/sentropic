---
name: folders
description: Read and update folders that group initiatives and workspace materials.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: folders_list
    description: List folders in the current workspace with organization and initiative counts.
    inputSchema:
      type: object
      properties:
        organizationId:
          type: string
          description: Optional organization filter.
  - name: folder_get
    description: Read one folder by id with its metadata and linked object summary.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Folder identifier.
      required: [folderId]
  - name: folder_update
    description: Update editable folder fields after caller approval and authorization.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
        patch:
          type: object
          additionalProperties: true
      required: [folderId, patch]
    sideEffect: true
    requiresApproval: true
---

# Folders skill

The `folders` skill exposes workspace-scoped folder tools. Use it when the user
asks to inspect, compare, or adjust folders that organize initiatives and their
associated documents or organization context.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
