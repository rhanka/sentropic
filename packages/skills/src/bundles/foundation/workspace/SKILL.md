---
name: workspace
description: Cross-workspace navigation and discovery — list accessible workspaces and search initiatives across them.
version: 0.1.0
category: workflow
tools:
  - name: workspace_list
    description: List all workspaces accessible to the current user with summary stats.
    inputSchema:
      type: object
      properties: {}
  - name: initiative_search
    description: Search initiatives across all accessible workspaces by name, status, or maturity stage.
    inputSchema:
      type: object
      properties:
        query:
          type: string
          description: Search query (matches initiative name or description).
        status:
          type: string
          description: Optional status filter.
        maturityStage:
          type: string
          description: Optional maturity stage filter (e.g. G0, G2).
---

# Workspace skill

The `workspace` skill exposes cross-workspace navigation primitives. It is the
agent's primary entry point when the current task spans multiple workspaces or
when the user asks "what are my workspaces" / "find an initiative about X".

## Tools

### `workspace_list`

Returns every workspace the caller can access along with high-level summary
stats (initiative count, latest activity, type). Always read-only.

### `initiative_search`

Search initiatives across every accessible workspace by `query` (matches
name/description), optional `status`, and optional `maturityStage` (e.g. G0,
G2). Read-only. Returns the top matches with their workspace id so the agent
can pivot to a workspace-scoped skill afterwards.

## Authorization

No fine-grained `authzRequirements`: any authenticated user can call these
tools; the underlying service enforces workspace-membership filtering.
