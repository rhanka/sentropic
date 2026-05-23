import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { commentAssistantHandlers } from './handler.js';

export const commentAssistantSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'comment_assistant',
  commentAssistantHandlers,
);
