# Changelog

## 0.3.3

- Add dedicated `@sentropic/comments/artifact-hono` Hono router (`createArtifactCommentsRouter`) over `CommentStore` for artifact comments: `threadId`-keyed thread verbs (`listThread`, `close`, `reopen`, `assign` with `null` unassign), `artifact` context filtering and target normalization, `section_key` inheritance on replies, injected per-artifact authorization port, HTTP `provenance.toolCallId` enforcement (`z.string().trim().min(1)`), and 2048-character `section_key` validation returning 400 `section_key_too_long`.

## 0.3.2

- Unify `CommentState` and `CommentEventType` on `'open' | 'closed'`.
