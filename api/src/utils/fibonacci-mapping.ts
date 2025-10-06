// Valeurs Fibonacci complètes pour le scoring IA
export const FIBONACCI_VALUES = [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100];

// Mapping des étoiles (5 niveaux)
export const STAR_MAPPING = [0, 2, 8, 34, 100];

/**
 * Convertit un score Fibonacci (0-100) en niveau d'étoiles (1-5)
 * @param fibonacciScore Score Fibonacci de l'IA (0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100)
 * @returns Niveau d'étoiles (1-5)
 */
export function fibonacciToStars(fibonacciScore: number): number {
  // Trouver le niveau d'étoiles le plus proche
  for (let i = 0; i < STAR_MAPPING.length; i++) {
    if (fibonacciScore <= STAR_MAPPING[i]) {
      return i + 1;
    }
  }
  return 5; // Maximum
}

/**
 * Convertit un niveau d'étoiles en score Fibonacci correspondant
 * @param starLevel Niveau d'étoiles (1-5)
 * @returns Score Fibonacci correspondant
 */
export function starsToFibonacci(starLevel: number): number {
  if (starLevel < 1) return 0;
  if (starLevel > 5) return 100;
  return STAR_MAPPING[starLevel - 1];
}

/**
 * Valide qu'un score est une valeur Fibonacci valide
 * @param score Score à valider
 * @returns true si c'est une valeur Fibonacci valide
 */
export function isValidFibonacciScore(score: number): boolean {
  return FIBONACCI_VALUES.includes(score);
}

/**
 * Trouve la valeur Fibonacci la plus proche d'un score donné
 * @param score Score à convertir
 * @returns Valeur Fibonacci la plus proche
 */
export function findNearestFibonacci(score: number): number {
  return FIBONACCI_VALUES.reduce((prev, curr) => 
    Math.abs(curr - score) < Math.abs(prev - score) ? curr : prev
  );
}
