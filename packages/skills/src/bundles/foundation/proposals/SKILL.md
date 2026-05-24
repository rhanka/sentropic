---
name: proposals
description: Read proposal and bid records in opportunity workspaces.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-ideas, opportunity]
tools:
  - name: proposals_list
    description: List proposals or bids in the current workspace.
    inputSchema:
      type: object
      properties:
        kind:
          type: string
          enum: [proposal, bid]
  - name: proposal_get
    description: Read one proposal or bid by id.
    inputSchema:
      type: object
      properties:
        proposalId:
          type: string
        kind:
          type: string
          enum: [proposal, bid]
      required: [proposalId]
---

# Proposals skill

The `proposals` skill exposes workspace-scoped proposal and bid object tools for
commercial response artifacts attached to opportunities.

Handlers are intentionally not bound until chat-service is rebound to
`SkillsToolRegistry`.
