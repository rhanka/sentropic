# Author and reviewer declarations

**Historical evidence.** Verdicts, pending conditions and hashes below describe their recorded revision. The [frozen storage alignment](storage-alignment.md) governs current work: M1 is owner-closed with carried reserves and unprovided handoff evidence; C0/module extensions and selected PG qualification remain separate. No historical proposal authorizes rewriting M1.

This is a header-only extract. Full execution logs are not promoted. Available declarations are recorded with whole-log digests for completed sessions and an explicitly bounded header digest for the active reserves session; neither a role name nor a CLI header proves effective routing.

| Field | AUTHOR-C6 | AUTHOR-2E | AUTHOR-PROMO | AUTHOR-RESERVES |
|---|---|---|---|---|
| Host / CLI | OpenAI Codex v0.162.1 | OpenAI Codex v0.162.1 | OpenAI Codex v0.162.1 | OpenAI Codex v0.162.1 |
| Declared model | `gpt-6-astra` | `gpt-6-astra` | `gpt-6-astra` | `gpt-6-astra` |
| Declared provider | `openai` | `openai` | `openai` | `openai` |
| Declared reasoning effort | `max` | `max` | `max` | `max` |
| Declared reasoning summaries | `none` | `none` | `none` | `none` |
| Session identifier | `01a12d2c-4ee7-73c1-b01f-61a0afa39263` | `01a12d5a-6e27-7ea3-bba1-a61812d37d69` | `01a12d75-71dd-7192-903a-abbb666fbcea` | `01a12d98-f3b4-7ec1-9e13-596425d6356a` |
| Treatment source | TREAT / C6 findings | TREAT2 / CONF2 findings | PROMOTE / CONF3 reservations | CONF4 / P-1–P-5 recording |
| Whole-log SHA-256 | `5373dfb50154276e04a215ccf106a81eaa0bdf8d3a3028ea8626fd0ea23d92d4` | `e1f463f5c637bc73f6090e71c85709469b2ec53f8ccfed1fe1635bcc97d34022` | `a1054074ade6a3366c5a3a66b0c1a1d6f7bd7ab2809b3c98926be3a0e2ec4440` | Active log; only the fixed header is pinned below. |

AUTHOR-C6 and AUTHOR-2E headers and whole-log digests were read/recomputed during the original promotion preparation and checked by CONF4. AUTHOR-2E matches CONF3 n-4 and supplies the declaration for the treatment producing c6d7a548. Those earlier headers attest no later session and do not retrospectively establish the initial revision author's model/effort.

AUTHOR-PROMO's own header and journal digest above are the ones reported by CONF4 P-2 and rechecked during reserves recording: 6,437,939 bytes, mtime 2026-10-11 20:32:31 −0400, stable at the review's 20:50 observation. This records the promotion session's declaration, not independent routing evidence.

AUTHOR-RESERVES is this recording session's own header, read directly from its local journal. Its first 12 lines (469 bytes, through the closing header separator) have SHA-256 `0ec2b810b47f164860392df756090af8a87ab02f8652b9b035f1a15c1ed80cbe`. The journal is still growing; this fixed-prefix digest is not a final whole-log digest. The declaration does not attest effective model/effort or the preceding promotion session.

## Review declarations and limits

| Review | Declared identity / effort | Independence and evidence limit |
|---|---|---|
| C6 | Claude Opus 5.5, `claude-opus-5-5`, declared max | Read-only reviewer; did not author the SPEC/log; same model family as SO/CROSS, effective independence unverifiable. |
| CONF2 | Claude Opus 5.5, `claude-opus-5-5`; max requested, reviewer cannot verify it | Reviewer also authored C6; not independent of the findings being confirmed. |
| CONF3 | Claude Opus 5.5, `claude-opus-5-5`; max requested, reviewer cannot verify it | Reviewer authored C6 and CONF2; read-only bounded confirmation, no subagents, not independent of those findings. |

The [index](index.md) pins each review's original digest. “Resolved” metadata means available declarations and their hashed sources are recorded with unverifiable limits; it does not mean independent identity attestation exists.

Future SPEC/plan/freeze assignments remain Astra max with Opus 5.5 max confirmation. BUILD remains Vibe GLM 5.3 or Gemini 3.8 high, cross-reviewed by the other. These assignments are not execution evidence. No agent or reviewer was launched in this files-only preparation.
