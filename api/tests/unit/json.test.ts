import { describe, it, expect } from 'vitest';
import { parseJson } from '../../src/utils/json';

describe('JSON Utils', () => {
  interface TestType {
    id: string;
    name: string;
    value: number;
  }

  const validObject: TestType = {
    id: 'test-123',
    name: 'Test Object',
    value: 42
  };

  describe('parseJson', () => {
    it('should parse valid JSON string', () => {
      const jsonString = JSON.stringify(validObject);
      const result = parseJson<TestType>(jsonString);

      expect(result).toEqual(validObject);
    });

    it('should return undefined for null input', () => {
      const result = parseJson<TestType>(null);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = parseJson<TestType>('');
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid JSON', () => {
      const result = parseJson<TestType>('invalid json');
      expect(result).toBeUndefined();
    });

    it('should return undefined for malformed JSON', () => {
      const result = parseJson<TestType>('{"incomplete": json');
      expect(result).toBeUndefined();
    });

    it('should parse primitive values', () => {
      expect(parseJson<string>('"hello"')).toBe('hello');
      expect(parseJson<number>('42')).toBe(42);
      expect(parseJson<boolean>('true')).toBe(true);
      expect(parseJson<null>('null')).toBe(null);
    });

    it('should parse arrays', () => {
      const array = [1, 2, 3, 'test'];
      const jsonString = JSON.stringify(array);
      const result = parseJson<typeof array>(jsonString);

      expect(result).toEqual(array);
    });

    it('should parse nested objects', () => {
      const nestedObject = {
        level1: {
          level2: {
            value: 'deep'
          }
        }
      };
      const jsonString = JSON.stringify(nestedObject);
      const result = parseJson<typeof nestedObject>(jsonString);

      expect(result).toEqual(nestedObject);
    });

    it('should handle empty objects and arrays', () => {
      expect(parseJson<{}>('{}')).toEqual({});
      expect(parseJson<[]>('[]')).toEqual([]);
    });

    it('should handle whitespace in JSON', () => {
      const jsonString = '  { "id": "test", "value": 42 }  ';
      const result = parseJson<TestType>(jsonString);

      expect(result).toEqual({
        id: 'test',
        value: 42
      });
    });

    it('should preserve type information', () => {
      const result = parseJson<TestType>(JSON.stringify(validObject));
      
      if (result) {
        // TypeScript should know these properties exist
        expect(typeof result.id).toBe('string');
        expect(typeof result.name).toBe('string');
        expect(typeof result.value).toBe('number');
      }
    });
  });
});
