import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { solutionsHandlers } from './handler.js';

export const solutionsSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'solutions',
  solutionsHandlers,
);
