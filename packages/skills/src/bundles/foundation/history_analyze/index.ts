import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { historyAnalyzeHandlers } from './handler.js';

export const historyAnalyzeSkill: Skill = loadFoundationSkill(
  import.meta.url,
  historyAnalyzeHandlers,
);
