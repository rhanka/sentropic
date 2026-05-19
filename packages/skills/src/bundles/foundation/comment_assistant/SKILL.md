---
name: comment_assistant
description: Analyze comment threads in the current context and propose or execute resolution actions after explicit user confirmation.
version: 0.1.0
category: workflow
tools:
  - name: comment_assistant
    description: Analyze comment threads in the current context and propose resolution actions. Use mode="suggest" to get a proposal; use mode="resolve" to execute actions ONLY after explicit user confirmation.
    inputSchema:
      type: object
      properties:
        mode:
          type: string
          enum: [suggest, resolve]
          description: suggest = propose actions, resolve = execute actions after user confirmation.
        contextType:
          type: string
          enum: [organization, folder, initiative, matrix, executive_summary]
          description: Context type for the comment scope.
        contextId:
          type: string
          description: Context ID for the comment scope.
        sectionKey:
          type: string
          description: Optional section key to narrow the analysis.
        threadId:
          type: string
          description: Optional thread ID to focus on a single thread.
        status:
          type: string
          enum: [open, closed]
          description: 'Optional status filter (default: open).'
        confirmation:
          type: string
          description: 'Required for resolve: explicit user confirmation (e.g., "yes").'
        actions:
          type: array
          description: Actions to apply in resolve mode.
          items:
            type: object
            properties:
              thread_id:
                type: string
                description: Thread ID to act on.
              action:
                type: string
                enum: [close, reassign, note]
                description: Action to execute.
              reassign_to:
                type: string
                description: User ID for reassign (required when action=reassign).
              note:
                type: string
                description: Resolution note content (required when action=note).
            required: [thread_id, action]
      required: [mode, contextType, contextId]
---

# Comment assistant skill

The `comment_assistant` skill inspects comment threads attached to a workspace
context (organization, folder, initiative, matrix, or executive summary) and
proposes or applies thread resolution actions. `mode="suggest"` returns a
proposal without side effects; `mode="resolve"` applies close / reassign / note
actions only after the caller has supplied explicit user confirmation.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
