import { describe, it, expect } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from '../../src/utils/cors';

describe('CORS utilities', () => {
  describe('isOriginAllowed', () => {
    it('should allow exact match origins', () => {
      const allowedOrigins = ['http://localhost:5173', 'https://example.com'];
      
      expect(isOriginAllowed('http://localhost:5173', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://example.com', allowedOrigins)).toBe(true);
    });

    it('should reject non-matching origins', () => {
      const allowedOrigins = ['http://localhost:5173'];
      
      expect(isOriginAllowed('http://localhost:3000', allowedOrigins)).toBe(false);
      expect(isOriginAllowed('https://malicious.com', allowedOrigins)).toBe(false);
    });

    it('should allow wildcard subdomain patterns', () => {
      const allowedOrigins = ['https://*.sent-tech.ca'];
      
      expect(isOriginAllowed('https://app.sent-tech.ca', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://api.sent-tech.ca', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://dev.sent-tech.ca', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://staging.app.sent-tech.ca', allowedOrigins)).toBe(true);
    });

    it('should reject origins that do not match wildcard pattern', () => {
      const allowedOrigins = ['https://*.sent-tech.ca'];
      
      expect(isOriginAllowed('https://sent-tech.ca', allowedOrigins)).toBe(false);
      expect(isOriginAllowed('https://sent-tech.com', allowedOrigins)).toBe(false);
      expect(isOriginAllowed('https://malicious-sent-tech.ca', allowedOrigins)).toBe(false);
      expect(isOriginAllowed('http://app.sent-tech.ca', allowedOrigins)).toBe(false); // Wrong protocol
    });

    it('should handle multiple patterns', () => {
      const allowedOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://*.sent-tech.ca',
        'https://*.example.com'
      ];
      
      expect(isOriginAllowed('http://localhost:5173', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:5173', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://app.sent-tech.ca', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://api.example.com', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://malicious.com', allowedOrigins)).toBe(false);
    });

    it('should be case-sensitive', () => {
      const allowedOrigins = ['https://App.sent-tech.ca'];
      
      expect(isOriginAllowed('https://App.sent-tech.ca', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://app.sent-tech.ca', allowedOrigins)).toBe(false);
    });

    it('should handle empty allowed origins list', () => {
      const allowedOrigins: string[] = [];
      
      expect(isOriginAllowed('http://localhost:5173', allowedOrigins)).toBe(false);
    });
  });

  describe('parseAllowedOrigins', () => {
    it('should parse comma-separated origins', () => {
      const input = 'http://localhost:5173,https://example.com,https://*.sent-tech.ca';
      const expected = ['http://localhost:5173', 'https://example.com', 'https://*.sent-tech.ca'];
      
      expect(parseAllowedOrigins(input)).toEqual(expected);
    });

    it('should trim whitespace', () => {
      const input = ' http://localhost:5173 , https://example.com , https://*.sent-tech.ca ';
      const expected = ['http://localhost:5173', 'https://example.com', 'https://*.sent-tech.ca'];
      
      expect(parseAllowedOrigins(input)).toEqual(expected);
    });

    it('should handle single origin', () => {
      const input = 'http://localhost:5173';
      const expected = ['http://localhost:5173'];
      
      expect(parseAllowedOrigins(input)).toEqual(expected);
    });

    it('should filter out empty strings', () => {
      const input = 'http://localhost:5173,,https://example.com,  ,';
      const expected = ['http://localhost:5173', 'https://example.com'];
      
      expect(parseAllowedOrigins(input)).toEqual(expected);
    });

    it('should handle empty string', () => {
      const input = '';
      const expected: string[] = [];
      
      expect(parseAllowedOrigins(input)).toEqual(expected);
    });
  });
});

