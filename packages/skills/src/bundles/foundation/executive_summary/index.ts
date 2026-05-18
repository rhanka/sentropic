import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { executiveSummaryHandlers } from './handler.js';

export const executiveSummarySkill: Skill = loadFoundationSkill(
  import.meta.url,
  executiveSummaryHandlers,
);
