import type { MatrixConfig, MatrixThreshold } from '../types/matrix';

export type ScoreEntry = {
  axisId: string;
  rating: number;
  description?: string;
};

const findPoints = (thresholds: MatrixThreshold[], level: number) => {
  const entry = thresholds.find((item) => item.level === level);
  return entry ? entry.points : 0;
};

const findThresholdValue = (thresholds: MatrixThreshold[], score: number) => {
  const sorted = [...thresholds].sort((a, b) => a.level - b.level);
  let level = 1;
  for (const item of sorted) {
    if (score >= item.threshold) {
      level = item.level;
    }
  }
  return level;
};

const maxPossibleScore = (axes: { weight: number }[], thresholds: MatrixThreshold[]) => {
  if (thresholds.length === 0) {
    return 0;
  }
  const maxLevel = Math.max(...thresholds.map((t) => t.level));
  const maxPoints = findPoints(thresholds, maxLevel);
  return axes.reduce((acc, axis) => acc + maxPoints * axis.weight, 0);
};

export const calculateScores = (
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
) => {
  const totalValueScore = valueScores.reduce((acc, entry) => {
    const axis = matrix.valueAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (!axis) return acc;
    const points = findPoints(matrix.valueThresholds, entry.rating);
    return acc + points * axis.weight;
  }, 0);

  const totalComplexityScore = complexityScores.reduce((acc, entry) => {
    const axis = matrix.complexityAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (!axis) return acc;
    const points = findPoints(matrix.complexityThresholds, entry.rating);
    return acc + points * axis.weight;
  }, 0);

  const valueLevel = findThresholdValue(matrix.valueThresholds, totalValueScore);
  const complexityLevel = findThresholdValue(matrix.complexityThresholds, totalComplexityScore);

  const maxValue = maxPossibleScore(matrix.valueAxes, matrix.valueThresholds);
  const maxComplexity = maxPossibleScore(matrix.complexityAxes, matrix.complexityThresholds);

  const valueNorm = maxValue === 0 ? 0 : Math.round((totalValueScore / maxValue) * 100);
  const complexityNorm = maxComplexity === 0 ? 0 : Math.round((totalComplexityScore / maxComplexity) * 100);

  return {
    totalValueScore,
    totalComplexityScore,
    valueLevel,
    complexityLevel,
    valueNorm,
    complexityNorm,
    ease: 100 - complexityNorm
  };
};
