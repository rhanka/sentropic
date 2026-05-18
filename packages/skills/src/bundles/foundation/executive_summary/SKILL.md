---
name: executive_summary
description: Read and update folder executive summaries in AI-ideas and opportunity workspaces.
version: 0.1.0
category: analysis
contextFilter:
  workspaceTypes: [ai-ideas, opportunity]
tools:
  - name: executive_summary_get
    description: Read the executive summary for a folder (stored on folders.executiveSummary).
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Folder ID owning the executive summary.
        select:
          type: array
          items:
            type: string
          description: Optional list of executive summary fields to include.
      required: [folderId]
  - name: executive_summary_update
    description: Update the executive summary fields for a folder after explicit caller approval.
    inputSchema:
      type: object
      properties:
        folderId:
          type: string
          description: Folder ID owning the executive summary.
        updates:
          type: array
          description: List of executive summary field updates to apply.
          items:
            type: object
            properties:
              field:
                type: string
                description: Executive summary field key.
              value:
                description: New value (string or JSON).
            required: [field, value]
      required: [folderId, updates]
    sideEffect: true
    requiresApproval: true
---

# Executive summary skill

The `executive_summary` skill exposes the structured summary attached to a
folder. Use it when the user wants to inspect or revise sections such as the
introduction, analysis, recommendations, executive synthesis, or references.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
