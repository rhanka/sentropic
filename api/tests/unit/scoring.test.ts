import { describe, it, expect } from 'vitest';
import { calculateScores, type ScoreEntry } from '../../src/utils/scoring';
import type { MatrixConfig } from '../../src/types/matrix';

describe('Scoring Utils', () => {
  const mockMatrix: MatrixConfig = {
    valueAxes: [
      { id: 'value1', name: 'Value Axis 1', weight: 0.3 },
      { id: 'value2', name: 'Value Axis 2', weight: 0.7 }
    ],
    complexityAxes: [
      { id: 'complexity1', name: 'Complexity Axis 1', weight: 0.4 },
      { id: 'complexity2', name: 'Complexity Axis 2', weight: 0.6 }
    ]
  };

  const mockValueScores: ScoreEntry[] = [
    { axisId: 'value1', rating: 5, description: 'Test value 1' },
    { axisId: 'value2', rating: 8, description: 'Test value 2' }
  ];

  const mockComplexityScores: ScoreEntry[] = [
    { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
    { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
  ];

  describe('calculateScores', () => {
    it('should calculate scores correctly with valid inputs', () => {
      const result = calculateScores(mockMatrix, mockValueScores, mockComplexityScores);

      // Value calculation: (5 * 0.3) + (8 * 0.7) = 1.5 + 5.6 = 7.1
      expect(result.totalValueScore).toBe(7.1);
      
      // Complexity calculation: (3 * 0.4) + (13 * 0.6) = 1.2 + 7.8 = 9.0
      expect(result.totalComplexityScore).toBe(9.0);
      
      // Max values: (10 * 0.3) + (10 * 0.7) = 10, (10 * 0.4) + (10 * 0.6) = 10
      expect(result.valueNorm).toBe(71); // 7.1/10 * 100 = 71
      expect(result.complexityNorm).toBe(90); // 9.0/10 * 100 = 90
      expect(result.ease).toBe(10); // 100 - 90 = 10
    });

    it('should handle empty scores arrays', () => {
      const result = calculateScores(mockMatrix, [], []);

      expect(result.totalValueScore).toBe(0);
      expect(result.totalComplexityScore).toBe(0);
      expect(result.valueNorm).toBe(0);
      expect(result.complexityNorm).toBe(0);
      expect(result.ease).toBe(100);
    });

    it('should handle missing axes gracefully', () => {
      const incompleteValueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' }
        // Missing value2
      ];

      const result = calculateScores(mockMatrix, incompleteValueScores, mockComplexityScores);

      // Only value1 should be calculated: 5 * 0.3 = 1.5
      expect(result.totalValueScore).toBe(1.5);
      expect(result.totalComplexityScore).toBe(9.0);
    });

    it('should handle invalid axis IDs', () => {
      const invalidValueScores: ScoreEntry[] = [
        { axisId: 'invalid_axis', rating: 5, description: 'Invalid axis' }
      ];

      const result = calculateScores(mockMatrix, invalidValueScores, mockComplexityScores);

      // Invalid axis should be ignored
      expect(result.totalValueScore).toBe(0);
      expect(result.totalComplexityScore).toBe(9.0);
    });

    it('should calculate levels correctly', () => {
      const result = calculateScores(mockMatrix, mockValueScores, mockComplexityScores);

      // valueLevel: 7.1/10 * 10 = 7.1 -> 7
      expect(result.valueLevel).toBe(7);
      
      // complexityLevel: 9.0/10 * 10 = 9.0 -> 9
      expect(result.complexityLevel).toBe(9);
    });

    it('should handle zero max values', () => {
      const emptyMatrix: MatrixConfig = {
        valueAxes: [],
        complexityAxes: []
      };

      const result = calculateScores(emptyMatrix, [], []);

      expect(result.valueNorm).toBe(0);
      expect(result.complexityNorm).toBe(0);
      expect(result.ease).toBe(100);
    });
  });
});
