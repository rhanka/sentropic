---
name: plan
description: Unified plan/todo/task runtime orchestration — create checklists, update TODO progression, and advance individual tasks.
version: 0.1.0
category: workflow
tools:
  - name: plan
    description: Unified plan runtime orchestration tool. Use action=create to create a checklist plan, action=update_plan to update plan-level progression, and action=update_task to progress a task.
    inputSchema:
      type: object
      properties:
        action:
          type: string
          enum: [create, update_plan, update_task]
          description: Operation to execute. create=create checklist; update_plan=update TODO status/content; update_task=update task status/content.
        title:
          type: string
          description: TODO/task title depending on action.
        description:
          type: string
          description: Optional TODO/task description depending on action.
        planId:
          type: string
          description: Optional existing plan ID (create action).
        planTitle:
          type: string
          description: Optional plan title; creates a new plan when planId is not provided (create action).
        tasks:
          type: array
          description: Optional initial tasks to create under the TODO (create action).
          items:
            type: object
            properties:
              title:
                type: string
                description: Task title (required).
              description:
                type: string
                description: Optional task description.
            required: [title]
        todoId:
          type: string
          description: TODO id to update (update_plan action).
        ownerUserId:
          type: string
          description: Optional TODO owner user id (update_plan action, reassignment permission required).
        closed:
          type: boolean
          description: Optional explicit TODO close flag (update_plan action).
        taskId:
          type: string
          description: Task id to update (update_task action).
        assigneeUserId:
          type: string
          description: Optional task assignee user id (update_task action, reassignment permission required).
        status:
          type: string
          enum: [todo, planned, in_progress, blocked, done, deferred, cancelled]
          description: Status transition target (update_plan/update_task).
        metadata:
          type: object
          description: Optional metadata object (create/update_plan/update_task).
      required: [action]
---

# Plan skill

The `plan` skill orchestrates plan/TODO/task entities for chat-driven
checklist workflows. Use `action=create` to draft a checklist with optional
initial tasks, `action=update_plan` to update TODO status, ownership, or
closure, and `action=update_task` to progress individual tasks.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
