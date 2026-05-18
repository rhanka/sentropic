import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { foldersHandlers } from './handler.js';

export const foldersSkill: Skill = loadFoundationSkill(
  import.meta.url,
  foldersHandlers,
);
