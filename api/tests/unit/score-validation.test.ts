import { describe, it, expect } from 'vitest';
import { validateScores, fixScores } from '../../src/utils/score-validation';
import type { MatrixConfig } from '../../src/types/matrix';
import type { ScoreEntry } from '../../src/utils/scoring';

describe('Score Validation Utils', () => {
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

  describe('validateScores', () => {
    it('should validate correct scores', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' },
        { axisId: 'value2', rating: 8, description: 'Test value 2' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
        { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
      ];

      const result = validateScores(mockMatrix, valueScores, complexityScores);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect missing value axes', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' }
        // Missing value2
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
        { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
      ];

      const result = validateScores(mockMatrix, valueScores, complexityScores);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Axes de valeur manquants: value2');
    });

    it('should detect missing complexity axes', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' },
        { axisId: 'value2', rating: 8, description: 'Test value 2' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' }
        // Missing complexity2
      ];

      const result = validateScores(mockMatrix, valueScores, complexityScores);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Axes de complexité manquants: complexity2');
    });

    it('should detect extra axes', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' },
        { axisId: 'value2', rating: 8, description: 'Test value 2' },
        { axisId: 'extra_value', rating: 5, description: 'Extra axis' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
        { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
      ];

      const result = validateScores(mockMatrix, valueScores, complexityScores);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Axes de valeur non reconnus: extra_value');
    });

    it('should warn about invalid Fibonacci ratings', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 4, description: 'Invalid rating' }, // 4 is not Fibonacci
        { axisId: 'value2', rating: 8, description: 'Valid rating' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
        { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
      ];

      const result = validateScores(mockMatrix, valueScores, complexityScores);

      expect(result.isValid).toBe(true); // Still valid, just warnings
      expect(result.warnings).toContain('Rating invalide pour l\'axe de valeur \'value1\': 4 (doit être une valeur Fibonacci)');
    });

    it('should handle empty scores arrays', () => {
      const result = validateScores(mockMatrix, [], []);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Axes de valeur manquants: value1, value2');
      expect(result.errors).toContain('Axes de complexité manquants: complexity1, complexity2');
    });
  });

  describe('fixScores', () => {
    it('should fix missing axes by adding default scores', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' }
        // Missing value2
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' }
        // Missing complexity2
      ];

      const result = fixScores(mockMatrix, valueScores, complexityScores);

      expect(result.valueScores).toHaveLength(2);
      expect(result.complexityScores).toHaveLength(2);

      // Check that missing axes are added with default values
      const value2Score = result.valueScores.find(score => score.axisId === 'value2');
      expect(value2Score).toBeDefined();
      expect(value2Score?.rating).toBe(5);
      expect(value2Score?.description).toBe('Score par défaut - axe manquant dans la génération');

      const complexity2Score = result.complexityScores.find(score => score.axisId === 'complexity2');
      expect(complexity2Score).toBeDefined();
      expect(complexity2Score?.rating).toBe(5);
      expect(complexity2Score?.description).toBe('Score par défaut - axe manquant dans la génération');
    });

    it('should remove invalid axes', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Valid axis' },
        { axisId: 'invalid_axis', rating: 8, description: 'Invalid axis' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Valid axis' },
        { axisId: 'another_invalid', rating: 13, description: 'Invalid axis' }
      ];

      const result = fixScores(mockMatrix, valueScores, complexityScores);

      expect(result.valueScores).toHaveLength(2); // value1 + value2 (added)
      expect(result.complexityScores).toHaveLength(2); // complexity1 + complexity2 (added)

      // Check that invalid axes are removed
      expect(result.valueScores.find(score => score.axisId === 'invalid_axis')).toBeUndefined();
      expect(result.complexityScores.find(score => score.axisId === 'another_invalid')).toBeUndefined();
    });

    it('should preserve valid scores', () => {
      const valueScores: ScoreEntry[] = [
        { axisId: 'value1', rating: 5, description: 'Test value 1' },
        { axisId: 'value2', rating: 8, description: 'Test value 2' }
      ];

      const complexityScores: ScoreEntry[] = [
        { axisId: 'complexity1', rating: 3, description: 'Test complexity 1' },
        { axisId: 'complexity2', rating: 13, description: 'Test complexity 2' }
      ];

      const result = fixScores(mockMatrix, valueScores, complexityScores);

      expect(result.valueScores).toHaveLength(2);
      expect(result.complexityScores).toHaveLength(2);

      // Check that original scores are preserved
      const value1Score = result.valueScores.find(score => score.axisId === 'value1');
      expect(value1Score?.rating).toBe(5);
      expect(value1Score?.description).toBe('Test value 1');
    });
  });
});
