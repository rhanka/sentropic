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

// --- Top-N prioritization ranking (BR-40a) ---
//
// Value and complexity are both normalized to the SAME 0-100 scale (weighted mean
// of Fibonacci-point ratings). Complexity CAN be 0, so the priority ratio uses an
// epsilon guard on the denominator and an upper cap to keep complexity≈0 cases from
// dividing by zero or dominating unboundedly.
//
// Exact constants (documented + unit-tested):
//   PRIORITY_EPSILON   = 1   -> denominator is `complexity + 1`, never 0
//   PRIORITY_RATIO_CAP = 100 -> max bound (value<=100 / (complexity+1)>=1 => natural max 100)
export const PRIORITY_EPSILON = 1;
export const PRIORITY_RATIO_CAP = 100;

export interface PriorityCandidate {
  value: number;
  complexity: number;
}

/**
 * Compute the prioritization ratio `value / (complexity + PRIORITY_EPSILON)`,
 * clamped to PRIORITY_RATIO_CAP. Higher is better (more value per unit of effort).
 */
export function computePriorityRatio(value: number, complexity: number): number {
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeComplexity = Number.isFinite(complexity) ? Math.max(0, complexity) : 0;
  const ratio = safeValue / (safeComplexity + PRIORITY_EPSILON);
  return Math.min(ratio, PRIORITY_RATIO_CAP);
}

/**
 * Select the indices of the top-N candidates ranked by priority ratio
 * `value / (complexity + PRIORITY_EPSILON)` (capped), ties broken by value desc,
 * then by original index asc for stability. Returns indices into the input array.
 */
export function selectTopPriorityIndices<T extends PriorityCandidate>(
  candidates: T[],
  topN: number
): number[] {
  return candidates
    .map((candidate, index) => ({
      index,
      value: Number.isFinite(candidate.value) ? candidate.value : 0,
      ratio: computePriorityRatio(candidate.value, candidate.complexity)
    }))
    .sort((a, b) => {
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      if (b.value !== a.value) return b.value - a.value;
      return a.index - b.index;
    })
    .slice(0, Math.max(0, topN))
    .map((entry) => entry.index);
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
