---
name: new-route
description: Scaffold a new API route following project patterns
paths: "api/src/routes/**"
allowed-tools: Read Write Bash Edit Glob Grep
---

## New Route Scaffold

Reference pattern: `api/src/routes/api/admin.ts`

1. Create Zod input schema for request validation
2. Create Hono router with route handlers
3. Apply middleware: `requireAuth()` + `requireWorkspaceAccessRole()` or `requireWorkspaceEditorRole()`
4. Call service layer (never query DB directly from route)
5. Register router in `api/src/routes/api/index.ts`
6. Ensure all service queries include `workspace_id` filter
7. Add test file: `api/tests/api/<name>.test.ts`
   - `beforeEach`: `createAuthenticatedUser('role')`
   - `afterEach`: `cleanupAuthData()`
   - Use `authenticatedRequest(app, method, path, token, body)`
