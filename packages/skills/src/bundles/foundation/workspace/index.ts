import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillSource } from '../../../format/parser.js';
import type { Skill } from '../../../types/skill.js';
import { workspaceHandlers } from './handler.js';

/**
 * Load the `workspace` foundation skill from its co-located `SKILL.md` source.
 *
 * The source is read at module-load time (single sync read) and cached as a
 * frozen `Skill`. Foundation bundles ship inside `@sentropic/skills`, so the
 * SKILL.md file is always available next to this module — no I/O failure mode
 * to defend against beyond a build-time misconfiguration.
 *
 * The parsed skill is composed with the placeholder `workspaceHandlers` map.
 * Handler binding to the real API service is deferred to the `chat-service`
 * rebind step of BR-19 Lot 5 (see `./handler.ts` for context).
 */
function loadWorkspaceSkill(): Skill {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'SKILL.md'), 'utf8');
  const parsed = parseSkillSource(source);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers: workspaceHandlers,
  });
}

/** Singleton `workspace` skill instance ready to register. */
export const workspaceSkill: Skill = loadWorkspaceSkill();
