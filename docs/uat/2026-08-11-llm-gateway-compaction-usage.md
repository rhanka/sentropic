# LLM gateway compaction usage UAT

Date: 2026-08-11

## Candidate

- Sentropic commit: `40ca1d8227e3d9d83e7fbc5d8b07022653ffe066`
- `@sentropic/llm-gateway`: `0.13.1`
- Gateway tarball SHA-256:
  `a1a3ecf48edf8e6faf602dd53bbc0330ecdad49dc7d4577f6ae45f110af3166a`
- `@sentropic/llm-mesh`: `0.15.0`
- Mesh tarball SHA-256:
  `e6ad6d8fda99ef4e19177f8204e781e4ec69ca0d3cacd10a0b01a992d7697900`
- h2a integration worktree:
  `/home/antoinefa/src/h2a/tmp/worktrees/gw-compaction-uat-093`
- h2a isolated-runner support commit: `b8ef4da3`

## Direct gateway integration

The h2a-owned lane installed the exact candidate tarballs and exercised the
real Hono `/v1/messages` SSE route on an isolated port and state directory.

- HTTP status: `200`
- `message_start.usage.input_tokens`: non-zero before provider completion
- terminal `message_delta.usage`: output tokens only
- Bash `input_json_delta`: preserved
- route accounting: one plan, one attempt, and one settlement
- h2a isolated-runner focused tests: `7/7` passing
- h2a build: passing

An earlier isolated attempt returned `503` because the sandbox mounted the
owner keyring read-only and `EncryptedFileKeyring.readMasterKey` could not run
`chmod`. The same candidate passed when rerun unsandboxed with a temporary
state directory and alternate port; the `503` was not attributed to the
gateway compaction contract or provider saturation.

## Real Claude Code UAT

The h2a owner ran an actual interactive Claude Code session through the
isolated candidate gateway, using the enrolled Codex route with
`gpt-5.6-sol`. Claude Code was not launched with
`--dangerously-skip-permissions`; Bash access was restricted to three exact
marker commands.

- `BEFORE` marker: observed
- first `/compact`: completed
- `AFTER_ONE` marker: observed after the first compaction
- second `/compact`: completed
- `AFTER_TWO` marker: observed after the second compaction
- compact signals observed: `4`
- tool continuation: passing
- session continuation after both compactions: passing

## Outcome

PASS. The h2a integration owner explicitly authorized Sentropic PR, CI,
merge, and npm publication of `@sentropic/llm-gateway@0.13.1`.
