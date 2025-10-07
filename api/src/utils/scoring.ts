import type { MatrixConfig } from '../types/matrix';

export type ScoreEntry = {
  axisId: string;
  rating: number;
  description: string;
};

const maxPossibleScore = (axes: { weight: number }[]) => {
  // Score maximum basé sur le poids des axes (rating max = 10)
  return axes.reduce((acc, axis) => acc + 10 * axis.weight, 0);
};

export const calculateScores = (
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
) => {
  const totalValueScore = valueScores.reduce((acc, entry) => {
    const axis = matrix.valueAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (!axis) return acc;
    return acc + entry.rating * axis.weight;
  }, 0);

  const totalComplexityScore = complexityScores.reduce((acc, entry) => {
    const axis = matrix.complexityAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (!axis) return acc;
    return acc + entry.rating * axis.weight;
  }, 0);

  const maxValue = maxPossibleScore(matrix.valueAxes);
  const maxComplexity = maxPossibleScore(matrix.complexityAxes);

  const valueNorm = maxValue === 0 ? 0 : Math.round((totalValueScore / maxValue) * 100);
  const complexityNorm = maxComplexity === 0 ? 0 : Math.round((totalComplexityScore / maxComplexity) * 100);

  return {
    totalValueScore,
    totalComplexityScore,
    valueLevel: Math.round(totalValueScore / maxValue * 10), // Niveau basé sur le pourcentage
    complexityLevel: Math.round(totalComplexityScore / maxComplexity * 10), // Niveau basé sur le pourcentage
    valueNorm,
    complexityNorm,
    ease: 100 - complexityNorm
  };
};
