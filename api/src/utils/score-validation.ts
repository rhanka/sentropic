import type { MatrixConfig } from '../types/matrix';
import type { ScoreEntry } from './scoring';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Valide que les scores générés correspondent bien à la matrice
 */
export function validateScores(
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Vérifier les axes de valeur
  const valueAxisIds = matrix.valueAxes.map(axis => axis.id);
  const providedValueAxisIds = valueScores.map(score => score.axisId);

  // Axes manquants
  const missingValueAxes = valueAxisIds.filter(id => !providedValueAxisIds.includes(id));
  if (missingValueAxes.length > 0) {
    errors.push(`Axes de valeur manquants: ${missingValueAxes.join(', ')}`);
  }

  // Axes en trop
  const extraValueAxes = providedValueAxisIds.filter(id => !valueAxisIds.includes(id));
  if (extraValueAxes.length > 0) {
    errors.push(`Axes de valeur non reconnus: ${extraValueAxes.join(', ')}`);
  }

  // Vérifier les axes de complexité
  const complexityAxisIds = matrix.complexityAxes.map(axis => axis.id);
  const providedComplexityAxisIds = complexityScores.map(score => score.axisId);

  // Axes manquants
  const missingComplexityAxes = complexityAxisIds.filter(id => !providedComplexityAxisIds.includes(id));
  if (missingComplexityAxes.length > 0) {
    errors.push(`Axes de complexité manquants: ${missingComplexityAxes.join(', ')}`);
  }

  // Axes en trop
  const extraComplexityAxes = providedComplexityAxisIds.filter(id => !complexityAxisIds.includes(id));
  if (extraComplexityAxes.length > 0) {
    errors.push(`Axes de complexité non reconnus: ${extraComplexityAxes.join(', ')}`);
  }

  // Vérifier les ratings (valeurs Fibonacci valides)
  const validFibonacciValues = [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100];
  
  valueScores.forEach(score => {
    if (!validFibonacciValues.includes(score.rating)) {
      warnings.push(`Rating invalide pour l'axe de valeur '${score.axisId}': ${score.rating} (doit être une valeur Fibonacci)`);
    }
  });

  complexityScores.forEach(score => {
    if (!validFibonacciValues.includes(score.rating)) {
      warnings.push(`Rating invalide pour l'axe de complexité '${score.axisId}': ${score.rating} (doit être une valeur Fibonacci)`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Corrige les scores en supprimant les axes invalides et en ajoutant les manquants
 */
export function fixScores(
  matrix: MatrixConfig,
  valueScores: ScoreEntry[],
  complexityScores: ScoreEntry[]
): { valueScores: ScoreEntry[]; complexityScores: ScoreEntry[] } {
  const valueAxisIds = matrix.valueAxes.map(axis => axis.id);
  const complexityAxisIds = matrix.complexityAxes.map(axis => axis.id);

  // Filtrer les scores de valeur valides
  const validValueScores = valueScores.filter(score => valueAxisIds.includes(score.axisId));
  
  // Ajouter les axes de valeur manquants avec un score par défaut
  const missingValueAxes = valueAxisIds.filter(id => !validValueScores.some(score => score.axisId === id));
  const defaultValueScores = missingValueAxes.map(axisId => ({
    axisId,
    rating: 5, // Score par défaut
    description: 'Score par défaut - axe manquant dans la génération'
  }));

  // Filtrer les scores de complexité valides
  const validComplexityScores = complexityScores.filter(score => complexityAxisIds.includes(score.axisId));
  
  // Ajouter les axes de complexité manquants avec un score par défaut
  const missingComplexityAxes = complexityAxisIds.filter(id => !validComplexityScores.some(score => score.axisId === id));
  const defaultComplexityScores = missingComplexityAxes.map(axisId => ({
    axisId,
    rating: 5, // Score par défaut
    description: 'Score par défaut - axe manquant dans la génération'
  }));

  return {
    valueScores: [...validValueScores, ...defaultValueScores],
    complexityScores: [...validComplexityScores, ...defaultComplexityScores]
  };
}
