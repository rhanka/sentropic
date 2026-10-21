import type { DecisionRule, JudgeCriterion } from './request.js';
import { has, hasOnlyKeys, isRecord, isText } from './validation.js';

export const scoreDirections = ['higher-is-better', 'lower-is-better', 'unordered'] as const;

export function isJudgeCriterion(value: unknown): value is JudgeCriterion {
  if (!isRecord(value)) return false;
  if (value.kind === 'registered') {
    return hasOnlyKeys(value, ['kind', 'criteriaId', 'revision'])
      && isText(value.criteriaId) && isText(value.revision);
  }
  if (!isText(value.instructions)) return false;
  if (value.kind === 'binary') {
    return hasOnlyKeys(value, ['kind', 'instructions', 'criteria']) && (!has(value, 'criteria')
      || (isRecord(value.criteria) && hasOnlyKeys(value.criteria, ['true', 'false'])
        && isText(value.criteria.true) && isText(value.criteria.false)));
  }
  const graded = value.kind === 'graded';
  if (!graded && value.kind !== 'choice') return false;
  const field = graded ? 'levels' : 'options';
  const identifier = graded ? 'label' : 'id';
  const entries = value[field];
  if (!hasOnlyKeys(value, ['kind', 'instructions', field, ...(graded ? ['direction'] : [])])
    || (graded && !scoreDirections.some((direction) => direction === value.direction))
    || !Array.isArray(entries) || !entries.length) return false;
  const identifiers = new Set<string>();
  return entries.every((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, [identifier, 'description'])) return false;
    const id = entry[identifier];
    if (!isText(id) || !isText(entry.description)) return false;
    if (identifiers.has(id)) return false;
    identifiers.add(id);
    return true;
  });
}

export function isJudgeDecisionRule(value: unknown): value is DecisionRule {
  if (!isRecord(value)) return false;
  if (value.kind === 'provider') return hasOnlyKeys(value, ['kind']);
  if (value.kind === 'threshold') {
    return hasOnlyKeys(value, ['kind', 'field', 'op', 'value']) && value.field === 'score'
      && (value.op === 'gte' || value.op === 'lte')
      && typeof value.value === 'number' && Number.isFinite(value.value);
  }
  return value.kind === 'labels' && hasOnlyKeys(value, ['kind', 'passing'])
    && Array.isArray(value.passing) && value.passing.length > 0
    && value.passing.every(isText) && new Set(value.passing).size === value.passing.length;
}
