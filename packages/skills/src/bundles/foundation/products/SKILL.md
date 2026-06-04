---
name: products
description: Read product records attached to opportunity workspaces.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: products_list
    description: List products in the current workspace.
    inputSchema:
      type: object
      properties: {}
  - name: product_get
    description: Read one product by id.
    inputSchema:
      type: object
      properties:
        productId:
          type: string
      required: [productId]
---

# Products skill

The `products` skill exposes workspace-scoped product object tools for products,
services, offerings, and opportunity product records.

Handlers are intentionally not bound until chat-service is rebound to
`SkillsToolRegistry`.
