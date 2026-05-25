import { parseSkillSource } from '../../../format/parser.js';
import type { Skill } from '../../../types/skill.js';
import { readFoundationSkillSource } from '../load-skill.js';
import { createDocumentGenerateHandlers } from './handler.js';

/**
 * The `document_generate` skill is loaded EAGERLY at module-load time so the
 * sandbox policy and tool descriptors are immediately available to the
 * `SkillRegistry`. Handlers close over the parsed `Skill` so the runtime
 * receives the SKILL.md-declared sandbox policy on every call.
 *
 * Custom load path (not via `loadFoundationSkill`) because the handlers need
 * a reference to the parsed Skill to forward to `SandboxRuntime.execute`.
 */
function loadDocumentGenerateSkill(): Skill {
  const source = readFoundationSkillSource(
    import.meta.url,
    'document_generate',
  );
  const parsed = parseSkillSource(source);
  const skill: Skill = {
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers: undefined,
  };
  const handlers = createDocumentGenerateHandlers(skill);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers,
  });
}

export const documentGenerateSkill: Skill = loadDocumentGenerateSkill();
