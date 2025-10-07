import { describe, it, expect } from 'vitest';
import { 
  fibonacciToStars, 
  starsToFibonacci, 
  isValidFibonacciScore, 
  findNearestFibonacci,
  FIBONACCI_VALUES,
  STAR_MAPPING
} from '../../src/utils/fibonacci-mapping';

describe('Fibonacci Mapping Utils', () => {
  describe('FIBONACCI_VALUES', () => {
    it('should contain correct Fibonacci values', () => {
      expect(FIBONACCI_VALUES).toEqual([0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]);
    });
  });

  describe('STAR_MAPPING', () => {
    it('should contain correct star mapping values', () => {
      expect(STAR_MAPPING).toEqual([0, 2, 8, 34, 100]);
    });
  });

  describe('fibonacciToStars', () => {
    it('should convert Fibonacci scores to correct star levels', () => {
      expect(fibonacciToStars(0)).toBe(1);   // 0 -> 1 star
      expect(fibonacciToStars(1)).toBe(2);   // 1 -> 2 stars
      expect(fibonacciToStars(2)).toBe(2);   // 2 -> 2 stars
      expect(fibonacciToStars(3)).toBe(3);   // 3 -> 3 stars
      expect(fibonacciToStars(5)).toBe(3);   // 5 -> 3 stars
      expect(fibonacciToStars(8)).toBe(3);   // 8 -> 3 stars
      expect(fibonacciToStars(13)).toBe(4);  // 13 -> 4 stars
      expect(fibonacciToStars(21)).toBe(4);  // 21 -> 4 stars
      expect(fibonacciToStars(34)).toBe(4);  // 34 -> 4 stars
      expect(fibonacciToStars(55)).toBe(5);  // 55 -> 5 stars
      expect(fibonacciToStars(89)).toBe(5);  // 89 -> 5 stars
      expect(fibonacciToStars(100)).toBe(5); // 100 -> 5 stars
    });

    it('should handle edge cases', () => {
      expect(fibonacciToStars(-1)).toBe(1);  // Negative -> 1 star
      expect(fibonacciToStars(150)).toBe(5); // Above max -> 5 stars
    });

    it('should handle values between mapping points', () => {
      expect(fibonacciToStars(4)).toBe(3);   // Between 2 and 8 -> 3 stars
      expect(fibonacciToStars(10)).toBe(4);  // Between 8 and 34 -> 4 stars
      expect(fibonacciToStars(50)).toBe(5);  // Between 34 and 100 -> 5 stars
    });
  });

  describe('starsToFibonacci', () => {
    it('should convert star levels to correct Fibonacci scores', () => {
      expect(starsToFibonacci(1)).toBe(0);   // 1 star -> 0
      expect(starsToFibonacci(2)).toBe(2);   // 2 stars -> 2
      expect(starsToFibonacci(3)).toBe(8);   // 3 stars -> 8
      expect(starsToFibonacci(4)).toBe(34);  // 4 stars -> 34
      expect(starsToFibonacci(5)).toBe(100); // 5 stars -> 100
    });

    it('should handle edge cases', () => {
      expect(starsToFibonacci(0)).toBe(0);   // Below min -> 0
      expect(starsToFibonacci(-1)).toBe(0);  // Negative -> 0
      expect(starsToFibonacci(6)).toBe(100); // Above max -> 100
    });
  });

  describe('isValidFibonacciScore', () => {
    it('should validate correct Fibonacci scores', () => {
      expect(isValidFibonacciScore(0)).toBe(true);
      expect(isValidFibonacciScore(1)).toBe(true);
      expect(isValidFibonacciScore(3)).toBe(true);
      expect(isValidFibonacciScore(5)).toBe(true);
      expect(isValidFibonacciScore(8)).toBe(true);
      expect(isValidFibonacciScore(13)).toBe(true);
      expect(isValidFibonacciScore(21)).toBe(true);
      expect(isValidFibonacciScore(34)).toBe(true);
      expect(isValidFibonacciScore(55)).toBe(true);
      expect(isValidFibonacciScore(89)).toBe(true);
      expect(isValidFibonacciScore(100)).toBe(true);
    });

    it('should reject invalid Fibonacci scores', () => {
      expect(isValidFibonacciScore(2)).toBe(false);
      expect(isValidFibonacciScore(4)).toBe(false);
      expect(isValidFibonacciScore(6)).toBe(false);
      expect(isValidFibonacciScore(7)).toBe(false);
      expect(isValidFibonacciScore(9)).toBe(false);
      expect(isValidFibonacciScore(10)).toBe(false);
      expect(isValidFibonacciScore(11)).toBe(false);
      expect(isValidFibonacciScore(12)).toBe(false);
      expect(isValidFibonacciScore(14)).toBe(false);
      expect(isValidFibonacciScore(15)).toBe(false);
      expect(isValidFibonacciScore(99)).toBe(false);
      expect(isValidFibonacciScore(101)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isValidFibonacciScore(-1)).toBe(false);
      expect(isValidFibonacciScore(0.5)).toBe(false);
      expect(isValidFibonacciScore(1.5)).toBe(false);
    });
  });

  describe('findNearestFibonacci', () => {
    it('should find the nearest Fibonacci value', () => {
      expect(findNearestFibonacci(0)).toBe(0);
      expect(findNearestFibonacci(1)).toBe(1);
      expect(findNearestFibonacci(2)).toBe(1);  // Closer to 1 than 3
      expect(findNearestFibonacci(4)).toBe(3);  // Closer to 3 than 5
      expect(findNearestFibonacci(6)).toBe(5);  // Closer to 5 than 8
      expect(findNearestFibonacci(7)).toBe(8);  // Closer to 8 than 5
      expect(findNearestFibonacci(10)).toBe(8); // Closer to 8 than 13
      expect(findNearestFibonacci(12)).toBe(13); // Closer to 13 than 8
      expect(findNearestFibonacci(50)).toBe(55); // Closer to 55 than 34
      expect(findNearestFibonacci(95)).toBe(100); // Closer to 100 than 89
      expect(findNearestFibonacci(100)).toBe(100);
    });

    it('should handle edge cases', () => {
      expect(findNearestFibonacci(-1)).toBe(0);   // Below min -> 0
      expect(findNearestFibonacci(150)).toBe(100); // Above max -> 100
    });

    it('should handle ties correctly (prefer lower value)', () => {
      expect(findNearestFibonacci(1.5)).toBe(1);  // Equidistant from 1 and 3, prefer 1
      expect(findNearestFibonacci(4.5)).toBe(5);  // Closer to 5 than 3
    });
  });
});
