import type { MatrixConfig } from '../../types/matrix';

export interface ScoreEntry {
  axisId: string;
  rating: number;
  description?: string;
}

// Mapping Fibonacci des niveaux aux points
const FIBONACCI_POINTS = [0, 2, 8, 21, 34, 55, 89, 100];

/**
 * Convertit un niveau (1-5) en points Fibonacci
 */
export function getFibonacciPoints(level: number): number {
  return FIBONACCI_POINTS[level - 1] || 0;
}

/**
 * Convertit un score Fibonacci en nombre d'étoiles (1-5)
 */
export function scoreToStars(score: number): number {
  // Mapping des scores Fibonacci aux étoiles (échelle 1-5) avec arrondi au plus proche
  // Échelle Fibonacci : 0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100
  const fibonacciScores = [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100];
  const starLevels = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]; // Mapping des scores Fibonacci aux étoiles
  
  // Trouver l'index du score Fibonacci le plus proche
  let closestIndex = 0;
  let minDistance = Math.abs(score - fibonacciScores[0]);
  
  for (let i = 1; i < fibonacciScores.length; i++) {
    const distance = Math.abs(score - fibonacciScores[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  
  return starLevels[closestIndex];
}

/**
 * Calcule le score final normalisé pour une catégorie (valeur ou complexité)
 */
export function calculateFinalScore(
  axes: Array<{ id: string; weight: number }>,
  scores: ScoreEntry[],
  thresholds: Array<{ level: number; points: number }>
): number {
  let totalWeightedScore = 0;
  let totalWeight = 0;
  
  for (const axis of axes) {
    const score = scores.find(s => s.axisId === axis.id);
    if (score) {
      // Utiliser directement le score Fibonacci (rating)
      totalWeightedScore += score.rating * axis.weight;
      totalWeight += axis.weight;
    }
  }
  
  return totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
}

/**
 * Calcule les scores pour un cas d'usage
 */
export function calculateUseCaseScores(
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
) {
  const finalValueScore = calculateFinalScore(
    matrix.valueAxes,
    valueScores,
    matrix.valueThresholds
  );
  
  const finalComplexityScore = calculateFinalScore(
    matrix.complexityAxes,
    complexityScores,
    matrix.complexityThresholds
  );
  
  return {
    finalValueScore,
    finalComplexityScore,
    valueStars: scoreToStars(finalValueScore),
    complexityStars: scoreToStars(finalComplexityScore)
  };
}

/**
 * Génère les étoiles visuelles (dorées + grises)
 */
export function generateStars(count: number, max: number = 5): { filled: number; empty: number } {
  // Clamp count entre 0 et max pour éviter les valeurs négatives
  const clampedCount = Math.max(0, Math.min(count, max));
  return {
    filled: clampedCount,
    empty: max - clampedCount
  };
}
