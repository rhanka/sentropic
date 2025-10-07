import { describe, it, expect } from 'vitest';
import { parseMatrixConfig } from '../../src/utils/matrix';
import type { MatrixConfig } from '../../src/types/matrix';

describe('Matrix Utils', () => {
  const validMatrixConfig: MatrixConfig = {
    valueAxes: [
      { id: 'value1', name: 'Value Axis 1', weight: 0.3 },
      { id: 'value2', name: 'Value Axis 2', weight: 0.7 }
    ],
    complexityAxes: [
      { id: 'complexity1', name: 'Complexity Axis 1', weight: 0.4 },
      { id: 'complexity2', name: 'Complexity Axis 2', weight: 0.6 }
    ]
  };

  describe('parseMatrixConfig', () => {
    it('should parse valid JSON string', () => {
      const jsonString = JSON.stringify(validMatrixConfig);
      const result = parseMatrixConfig(jsonString);

      expect(result).toEqual(validMatrixConfig);
    });

    it('should return null for null input', () => {
      const result = parseMatrixConfig(null);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseMatrixConfig('');
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const result = parseMatrixConfig('invalid json');
      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const result = parseMatrixConfig('{"incomplete": json');
      expect(result).toBeNull();
    });

    it('should return parsed value for non-object JSON (no validation)', () => {
      const result = parseMatrixConfig('"just a string"');
      expect(result).toBe('just a string');
    });

    it('should return parsed value for array JSON (no validation)', () => {
      const result = parseMatrixConfig('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle empty matrix config', () => {
      const emptyConfig: MatrixConfig = {
        valueAxes: [],
        complexityAxes: []
      };
      const jsonString = JSON.stringify(emptyConfig);
      const result = parseMatrixConfig(jsonString);

      expect(result).toEqual(emptyConfig);
    });

    it('should handle matrix with single axis', () => {
      const singleAxisConfig: MatrixConfig = {
        valueAxes: [
          { id: 'single_value', name: 'Single Value Axis', weight: 1.0 }
        ],
        complexityAxes: []
      };
      const jsonString = JSON.stringify(singleAxisConfig);
      const result = parseMatrixConfig(jsonString);

      expect(result).toEqual(singleAxisConfig);
    });

    it('should handle whitespace in JSON', () => {
      const jsonString = '  { "valueAxes": [], "complexityAxes": [] }  ';
      const result = parseMatrixConfig(jsonString);

      expect(result).toEqual({
        valueAxes: [],
        complexityAxes: []
      });
    });
  });
});
