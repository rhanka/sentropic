import type { MatrixConfig } from '../types/matrix';
import type { ScoreEntry, UseCase, UseCaseData } from '../types/usecase';

// Re-export for backward compatibility
export type { ScoreEntry } from '../types/usecase';

const maxPossibleScore = (axes: { weight: number }[]) => {
  // Score maximum basé sur le poids des axes (rating max = 10)
  return axes.reduce((acc, axis) => acc + 10 * axis.weight, 0);
};

export const calculateScores = (
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
) => {
  // Calculer la moyenne pondérée (mean) pour valeur
  let totalWeightedValueScore = 0;
  let totalValueWeight = 0;
  for (const entry of valueScores) {
    const axis = matrix.valueAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (axis) {
      totalWeightedValueScore += entry.rating * axis.weight;
      totalValueWeight += axis.weight;
    }
  }
  const totalValueScore = totalValueWeight > 0 ? Math.round(totalWeightedValueScore / totalValueWeight) : 0;

  // Calculer la moyenne pondérée (mean) pour complexité
  let totalWeightedComplexityScore = 0;
  let totalComplexityWeight = 0;
  for (const entry of complexityScores) {
    const axis = matrix.complexityAxes.find((axisItem) => axisItem.id === entry.axisId);
    if (axis) {
      totalWeightedComplexityScore += entry.rating * axis.weight;
      totalComplexityWeight += axis.weight;
    }
  }
  const totalComplexityScore = totalComplexityWeight > 0 ? Math.round(totalWeightedComplexityScore / totalComplexityWeight) : 0;

  const maxValue = maxPossibleScore(matrix.valueAxes);
  const maxComplexity = maxPossibleScore(matrix.complexityAxes);

  const valueNorm = maxValue === 0 ? 0 : Math.round((totalValueScore / maxValue) * 100);
  const complexityNorm = maxComplexity === 0 ? 0 : Math.round((totalComplexityScore / maxComplexity) * 100);

  return {
    totalValueScore,
    totalComplexityScore,
    valueLevel: maxValue === 0 ? 0 : Math.round(totalValueScore / maxValue * 10), // Niveau basé sur le pourcentage
    complexityLevel: maxComplexity === 0 ? 0 : Math.round(totalComplexityScore / maxComplexity * 10), // Niveau basé sur le pourcentage
    valueNorm,
    complexityNorm,
    ease: 100 - complexityNorm
  };
};

/**
 * Calcule les scores totaux pour un cas d'usage à partir de sa matrice et de ses scores détaillés
 * Cette fonction remplace l'ancien stockage de totalValueScore et totalComplexityScore
 * 
 * @param matrix - Configuration de la matrice de notation
 * @param useCaseData - Données du cas d'usage (data JSONB)
 * @returns Scores calculés (totalValueScore, totalComplexityScore, etc.) ou null si pas de matrice
 */
export const calculateUseCaseScores = (
  matrix: MatrixConfig | null,
  useCaseData: UseCaseData
): {
  totalValueScore: number | null;
  totalComplexityScore: number | null;
  valueNorm: number;
  complexityNorm: number;
  valueLevel: number;
  complexityLevel: number;
  ease: number;
} | null => {
  if (!matrix) {
    return null;
  }

  const valueScores = useCaseData.valueScores ?? [];
  const complexityScores = useCaseData.complexityScores ?? [];
  
  return calculateScores(matrix, valueScores, complexityScores);
};
