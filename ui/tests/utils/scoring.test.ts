import { describe, it, expect } from 'vitest';
import {
  getFibonacciPoints,
  scoreToStars,
  calculateFinalScore,
  calculateUseCaseScores,
  generateStars,
  computePriorityRatio,
  selectTopPriorityIndices,
  PRIORITY_EPSILON,
  PRIORITY_RATIO_CAP,
  type ScoreEntry
} from '../../src/lib/utils/scoring';
import type { MatrixConfig } from '../../src/types/matrix';

describe('scoring utilities', () => {
  describe('getFibonacciPoints', () => {
    it('should return correct Fibonacci points for valid levels', () => {
      expect(getFibonacciPoints(1)).toBe(0);
      expect(getFibonacciPoints(2)).toBe(2);
      expect(getFibonacciPoints(3)).toBe(8);
      expect(getFibonacciPoints(4)).toBe(21);
      expect(getFibonacciPoints(5)).toBe(34);
      expect(getFibonacciPoints(6)).toBe(55);
      expect(getFibonacciPoints(7)).toBe(89);
      expect(getFibonacciPoints(8)).toBe(100);
    });

    it('should return 0 for invalid levels', () => {
      expect(getFibonacciPoints(0)).toBe(0);
      expect(getFibonacciPoints(-1)).toBe(0);
      expect(getFibonacciPoints(9)).toBe(0);
    });
  });

  describe('scoreToStars', () => {
    it('should convert scores to correct star levels', () => {
      expect(scoreToStars(0)).toBe(0);
      expect(scoreToStars(1)).toBe(1);
      expect(scoreToStars(3)).toBe(2);
      expect(scoreToStars(5)).toBe(2);
      expect(scoreToStars(8)).toBe(3);
      expect(scoreToStars(13)).toBe(3);
      expect(scoreToStars(21)).toBe(4);
      expect(scoreToStars(34)).toBe(4);
      expect(scoreToStars(55)).toBe(5);
      expect(scoreToStars(89)).toBe(5);
      expect(scoreToStars(100)).toBe(5);
    });

    it('should handle intermediate scores by finding closest match', () => {
      expect(scoreToStars(2)).toBe(1); // Closest to 1
      expect(scoreToStars(4)).toBe(2); // Closest to 3 or 5
      expect(scoreToStars(10)).toBe(3); // Closest to 8 or 13
    });
  });

  describe('calculateFinalScore', () => {
    const mockAxes = [
      { id: 'axis1', weight: 2 },
      { id: 'axis2', weight: 1 },
      { id: 'axis3', weight: 3 }
    ];

    const mockThresholds = [
      { level: 1, points: 0 },
      { level: 2, points: 2 },
      { level: 3, points: 8 }
    ];

    it('should calculate weighted average correctly', () => {
      const scores: ScoreEntry[] = [
        { axisId: 'axis1', rating: 10 },
        { axisId: 'axis2', rating: 20 },
        { axisId: 'axis3', rating: 30 }
      ];

      const result = calculateFinalScore(mockAxes, scores, mockThresholds);
      
      // (10*2 + 20*1 + 30*3) / (2+1+3) = (20 + 20 + 90) / 6 = 130/6 = 21.67 -> 22
      expect(result).toBe(22);
    });

    it('should handle missing scores', () => {
      const scores: ScoreEntry[] = [
        { axisId: 'axis1', rating: 10 },
        // axis2 missing
        { axisId: 'axis3', rating: 30 }
      ];

      const result = calculateFinalScore(mockAxes, scores, mockThresholds);
      
      // (10*2 + 30*3) / (2+3) = (20 + 90) / 5 = 110/5 = 22
      expect(result).toBe(22);
    });

    it('should return 0 when no scores match axes', () => {
      const scores: ScoreEntry[] = [
        { axisId: 'nonexistent', rating: 10 }
      ];

      const result = calculateFinalScore(mockAxes, scores, mockThresholds);
      expect(result).toBe(0);
    });

    it('should return 0 when no axes provided', () => {
      const scores: ScoreEntry[] = [
        { axisId: 'axis1', rating: 10 }
      ];

      const result = calculateFinalScore([], scores, mockThresholds);
      expect(result).toBe(0);
    });
  });

  describe('calculateUseCaseScores', () => {
    const mockMatrix: MatrixConfig = {
      valueAxes: [
        { id: 'value1', weight: 2 },
        { id: 'value2', weight: 1 }
      ],
      complexityAxes: [
        { id: 'complexity1', weight: 1 },
        { id: 'complexity2', weight: 2 }
      ],
      valueThresholds: [
        { level: 1, points: 0 },
        { level: 2, points: 2 }
      ],
      complexityThresholds: [
        { level: 1, points: 0 },
        { level: 2, points: 2 }
      ]
    };

    it('should calculate both value and complexity scores', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 10 },
        { axisId: 'value2', rating: 20 }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 15 },
        { axisId: 'complexity2', rating: 25 }
      ];

      const result = calculateUseCaseScores(mockMatrix, valueScores, complexityScores);

      expect(result).toHaveProperty('finalValueScore');
      expect(result).toHaveProperty('finalComplexityScore');
      expect(result).toHaveProperty('valueStars');
      expect(result).toHaveProperty('complexityStars');
    });

    it('should calculate correct star ratings', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 21 } // Should map to 4 stars
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 55 } // Should map to 5 stars
      ];

      const result = calculateUseCaseScores(mockMatrix, valueScores, complexityScores);

      expect(result.valueStars).toBe(4);
      expect(result.complexityStars).toBe(5);
    });
  });

  describe('generateStars', () => {
    it('should generate correct filled and empty stars', () => {
      expect(generateStars(3, 5)).toEqual({ filled: 3, empty: 2 });
      expect(generateStars(0, 5)).toEqual({ filled: 0, empty: 5 });
      expect(generateStars(5, 5)).toEqual({ filled: 5, empty: 0 });
    });

    it('should cap filled stars at max', () => {
      expect(generateStars(10, 5)).toEqual({ filled: 5, empty: 0 });
    });

    it('should handle negative counts', () => {
      expect(generateStars(-1, 5)).toEqual({ filled: 0, empty: 5 });
    });

    it('should use default max of 5', () => {
      expect(generateStars(3)).toEqual({ filled: 3, empty: 2 });
    });
  });

  describe('computePriorityRatio (BR-40a)', () => {
    it('uses value / (complexity + epsilon) with epsilon = 1', () => {
      expect(PRIORITY_EPSILON).toBe(1);
      // 50 / (9 + 1) = 5
      expect(computePriorityRatio(50, 9)).toBe(5);
    });

    it('guards complexity = 0 with the epsilon denominator (no division by zero)', () => {
      // 40 / (0 + 1) = 40, finite and not Infinity
      expect(computePriorityRatio(40, 0)).toBe(40);
      expect(Number.isFinite(computePriorityRatio(40, 0))).toBe(true);
    });

    it('caps the ratio at PRIORITY_RATIO_CAP', () => {
      expect(PRIORITY_RATIO_CAP).toBe(100);
      // 100 / (0 + 1) = 100, exactly at the cap (not above)
      expect(computePriorityRatio(100, 0)).toBe(100);
    });

    it('treats non-finite or negative complexity safely', () => {
      expect(computePriorityRatio(50, Number.NaN)).toBe(50); // complexity -> 0
      expect(computePriorityRatio(50, -10)).toBe(50); // negative clamped to 0
    });
  });

  describe('selectTopPriorityIndices (BR-40a)', () => {
    it('returns indices ordered by priority ratio descending', () => {
      const candidates = [
        { value: 10, complexity: 90 }, // ratio ~0.11
        { value: 80, complexity: 10 }, // ratio ~7.27
        { value: 50, complexity: 5 }   // ratio ~8.33
      ];
      expect(selectTopPriorityIndices(candidates, 3)).toEqual([2, 1, 0]);
    });

    it('labels only the top-N (10) when more candidates exist', () => {
      const candidates = Array.from({ length: 20 }, (_, i) => ({
        value: i + 1, // increasing value
        complexity: 0
      }));
      const top = selectTopPriorityIndices(candidates, 10);
      expect(top).toHaveLength(10);
      // Highest value (index 19) ranks first
      expect(top[0]).toBe(19);
      expect(top).not.toContain(0);
    });

    it('breaks ties by value descending then original index ascending', () => {
      const candidates = [
        { value: 20, complexity: 1 }, // ratio = 10
        { value: 40, complexity: 3 }, // ratio = 10, higher value
        { value: 10, complexity: 0 }  // ratio = 10, same ratio, lower value
      ];
      // All ratio 10: order by value desc -> idx1 (40), idx0 (20), idx2 (10)
      expect(selectTopPriorityIndices(candidates, 3)).toEqual([1, 0, 2]);
    });

    it('returns all indices when fewer candidates than topN', () => {
      const candidates = [
        { value: 10, complexity: 1 },
        { value: 20, complexity: 1 }
      ];
      expect(selectTopPriorityIndices(candidates, 10).sort()).toEqual([0, 1]);
    });

    it('returns an empty array for topN <= 0', () => {
      expect(selectTopPriorityIndices([{ value: 10, complexity: 1 }], 0)).toEqual([]);
    });
  });
});
