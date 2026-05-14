# SPEC_VOL — @sentropic/skills

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Livrer un catalogue + sandbox de capabilities agentiques distribuables (skills = bundle instructions + tools + context filter + sandbox policy, format `SKILL.md`). Invocable depuis tout agent runtime : `@sentropic/chat-core`, `@sentropic/flow`, CLI custom bâti sur `@sentropic/harness`. Distribution via npm + GitHub releases + export MCP server vers `mcp.so` pour interop cross-CLI (Claude Code, Codex, Gemini). Owns `SkillsToolRegistry` (impl de `ToolRegistry`) composable par les agent runtimes.

## Non-goal

Pas de gouvernance / policy / audit (réservé à `@sentropic/marketplace`). Pas de runtime CLI (consommé par harness ou par agent runtime). Pas d'agent marketplace (vendre des agents complets type GPT Store — hors scope). Pas de registry propriétaire avant business case explicite.
