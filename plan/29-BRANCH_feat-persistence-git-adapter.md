# Branch Plan Stub: BR-29 Persistence Git Adapter

Current coordination source:

- `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§1 cartography, §12 `CheckpointStore<T>`, §14 `RepoCheckpointStore` rewind UX)
- `spec/SPEC_VOL_PERSISTENCE_GIT.md` (to be authored in BR-23 PR #148 scope)

Branch:

- BR-29 `feat/persistence-git-adapter`
- Worktree (when launched): `tmp/feat-persistence-git-adapter`

Ordering rule:

- BR-29 runs after BR-14b (`@sentropic/contracts` + `@sentropic/chat-core`) merges, since the `CheckpointStore<T>` port and `CheckpointVersion`/`CheckpointMeta` types are defined in those packages.
- BR-29 is orthogonal to BR-26 (`flow`) — same port, separate adapter.

Scope summary:

- Ship `@sentropic/persistence-git` implementing `CheckpointStore<T>` using a shadow git repo at `~/.sentropic/checkpoints/<workspace-id>` (Gemini CLI / Aider parity).
- OCC strategy: **lenient only** (merge-conflict UX, never `VersionConflict` for chat).
- Storage primitives: `git hash-object` + `update-ref`; optional remote push (Gist / GitHub) for cloud backup.
- Restoration strategies on dirty working tree: `abort` / `auto-stash` / `prompt` — surfaced via the harness `/rewind` command (BR-25 consumer).
- Out of scope: replacing the production `persistence-postgres` adapter; this branch ships the CLI-/dev-oriented adapter only.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Confirm `CheckpointStore<T>` and `CheckpointVersion` are exported from `@sentropic/contracts` (or chat-core re-export).
- Define exact filesystem layout and ref naming under `~/.sentropic/checkpoints/`.
