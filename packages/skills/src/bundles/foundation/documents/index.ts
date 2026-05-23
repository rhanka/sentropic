import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { documentsHandlers } from './handler.js';

export const documentsSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'documents',
  documentsHandlers,
);
