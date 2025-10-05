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
 * Convertit un score en nombre d'étoiles (1-5)
 */
export function scoreToStars(score: number): number {
  let closestLevel = 1;
  let minDiff = Math.abs(score - FIBONACCI_POINTS[0]);
  
  for (let i = 1; i < FIBONACCI_POINTS.length; i++) {
    const diff = Math.abs(score - FIBONACCI_POINTS[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closestLevel = i + 1;
    }
  }
  
  return closestLevel;
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
      const points = getFibonacciPoints(score.rating);
      totalWeightedScore += points * axis.weight;
      totalWeight += axis.weight;
    }
  }
  
  return totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
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
  return {
    filled: Math.min(count, max),
    empty: Math.max(0, max - count)
  };
}
