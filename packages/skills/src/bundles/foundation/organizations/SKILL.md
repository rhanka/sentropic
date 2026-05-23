---
name: organizations
description: Read and update organization records in AI-ideas and opportunity workspaces.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-ideas, opportunity]
tools:
  - name: organizations_list
    description: List organizations visible in the current workspace with summary metadata.
    inputSchema:
      type: object
      properties: {}
  - name: organization_get
    description: Read one organization by id with its structured business data.
    inputSchema:
      type: object
      properties:
        organizationId:
          type: string
          description: Organization identifier.
      required: [organizationId]
  - name: organization_update
    description: Update editable organization fields after caller approval and authorization.
    inputSchema:
      type: object
      properties:
        organizationId:
          type: string
        patch:
          type: object
          additionalProperties: true
      required: [organizationId, patch]
    sideEffect: true
    requiresApproval: true
---

# Organizations skill

The `organizations` skill exposes workspace-scoped organization object tools.
Use it when the user asks about companies, clients, accounts, or organization
records attached to folders, initiatives, opportunities, solutions, products, or
proposals.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
