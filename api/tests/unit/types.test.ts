import { describe, it, expect } from 'vitest';
import type { 
  LevelDescription, 
  MatrixAxis, 
  MatrixThreshold, 
  MatrixConfig 
} from '../../src/types/matrix';

describe('Matrix Types', () => {
  describe('LevelDescription', () => {
    it('should have correct structure', () => {
      const levelDesc: LevelDescription = {
        level: 1,
        description: 'Low complexity'
      };

      expect(levelDesc.level).toBe(1);
      expect(levelDesc.description).toBe('Low complexity');
      expect(typeof levelDesc.level).toBe('number');
      expect(typeof levelDesc.description).toBe('string');
    });
  });

  describe('MatrixAxis', () => {
    it('should have correct structure with required fields', () => {
      const axis: MatrixAxis = {
        id: 'test-axis',
        name: 'Test Axis',
        weight: 0.5
      };

      expect(axis.id).toBe('test-axis');
      expect(axis.name).toBe('Test Axis');
      expect(axis.weight).toBe(0.5);
      expect(typeof axis.id).toBe('string');
      expect(typeof axis.name).toBe('string');
      expect(typeof axis.weight).toBe('number');
    });

    it('should support optional fields', () => {
      const axis: MatrixAxis = {
        id: 'test-axis',
        name: 'Test Axis',
        weight: 0.5,
        description: 'Optional description',
        levelDescriptions: [
          { level: 1, description: 'Low' },
          { level: 2, description: 'Medium' }
        ]
      };

      expect(axis.description).toBe('Optional description');
      expect(axis.levelDescriptions).toHaveLength(2);
      expect(axis.levelDescriptions?.[0].level).toBe(1);
      expect(axis.levelDescriptions?.[0].description).toBe('Low');
    });
  });

  describe('MatrixThreshold', () => {
    it('should have correct structure with required fields', () => {
      const threshold: MatrixThreshold = {
        level: 1,
        points: 10
      };

      expect(threshold.level).toBe(1);
      expect(threshold.points).toBe(10);
      expect(typeof threshold.level).toBe('number');
      expect(typeof threshold.points).toBe('number');
    });

    it('should support optional cases field', () => {
      const threshold: MatrixThreshold = {
        level: 1,
        points: 10,
        cases: 5
      };

      expect(threshold.cases).toBe(5);
      expect(typeof threshold.cases).toBe('number');
    });
  });

  describe('MatrixConfig', () => {
    it('should have correct structure', () => {
      const config: MatrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value Axis 1', weight: 0.3 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity Axis 1', weight: 0.4 }
        ],
        valueThresholds: [
          { level: 1, points: 10 }
        ],
        complexityThresholds: [
          { level: 1, points: 5 }
        ]
      };

      expect(config.valueAxes).toHaveLength(1);
      expect(config.complexityAxes).toHaveLength(1);
      expect(config.valueThresholds).toHaveLength(1);
      expect(config.complexityThresholds).toHaveLength(1);
      expect(Array.isArray(config.valueAxes)).toBe(true);
      expect(Array.isArray(config.complexityAxes)).toBe(true);
      expect(Array.isArray(config.valueThresholds)).toBe(true);
      expect(Array.isArray(config.complexityThresholds)).toBe(true);
    });

    it('should support empty arrays', () => {
      const config: MatrixConfig = {
        valueAxes: [],
        complexityAxes: [],
        valueThresholds: [],
        complexityThresholds: []
      };

      expect(config.valueAxes).toHaveLength(0);
      expect(config.complexityAxes).toHaveLength(0);
      expect(config.valueThresholds).toHaveLength(0);
      expect(config.complexityThresholds).toHaveLength(0);
    });

    it('should support multiple axes and thresholds', () => {
      const config: MatrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value Axis 1', weight: 0.3 },
          { id: 'value2', name: 'Value Axis 2', weight: 0.7 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity Axis 1', weight: 0.4 },
          { id: 'complexity2', name: 'Complexity Axis 2', weight: 0.6 }
        ],
        valueThresholds: [
          { level: 1, points: 10 },
          { level: 2, points: 20 }
        ],
        complexityThresholds: [
          { level: 1, points: 5 },
          { level: 2, points: 15 }
        ]
      };

      expect(config.valueAxes).toHaveLength(2);
      expect(config.complexityAxes).toHaveLength(2);
      expect(config.valueThresholds).toHaveLength(2);
      expect(config.complexityThresholds).toHaveLength(2);
    });
  });

  describe('Type compatibility', () => {
    it('should allow assignment between compatible types', () => {
      const levelDesc: LevelDescription = { level: 1, description: 'Test' };
      const axis: MatrixAxis = {
        id: 'test',
        name: 'Test',
        weight: 0.5,
        levelDescriptions: [levelDesc]
      };

      expect(axis.levelDescriptions?.[0]).toEqual(levelDesc);
    });

    it('should support complex nested structures', () => {
      const config: MatrixConfig = {
        valueAxes: [
          {
            id: 'value1',
            name: 'Value Axis 1',
            weight: 0.3,
            description: 'First value axis',
            levelDescriptions: [
              { level: 1, description: 'Low value' },
              { level: 2, description: 'High value' }
            ]
          }
        ],
        complexityAxes: [
          {
            id: 'complexity1',
            name: 'Complexity Axis 1',
            weight: 0.4,
            levelDescriptions: [
              { level: 1, description: 'Simple' },
              { level: 2, description: 'Complex' }
            ]
          }
        ],
        valueThresholds: [
          { level: 1, points: 10, cases: 2 },
          { level: 2, points: 20, cases: 5 }
        ],
        complexityThresholds: [
          { level: 1, points: 5, cases: 1 },
          { level: 2, points: 15, cases: 3 }
        ]
      };

      expect(config.valueAxes[0].levelDescriptions).toHaveLength(2);
      expect(config.valueThresholds[0].cases).toBe(2);
      expect(config.complexityThresholds[1].cases).toBe(3);
    });
  });
});
