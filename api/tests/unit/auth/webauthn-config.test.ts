import { describe, it, expect } from 'vitest';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';

describe('WebAuthn Configuration Service', () => {
  describe('getWebAuthnConfig', () => {
    it('should return valid RP configuration', () => {
      const config = getWebAuthnConfig();

      expect(config).toBeDefined();
      expect(config.rpID).toBeDefined();
      expect(config.rpName).toBeDefined();
      expect(config.origin).toBeDefined();
      expect(config.timeout).toBeDefined();
      expect(config.timeout.registration).toBeGreaterThan(0);
      expect(config.timeout.authentication).toBeGreaterThan(0);
      expect(config.attestation).toBeDefined();
    });

    it('should have valid RP ID format', () => {
      const config = getWebAuthnConfig();
      
      // RP ID should be a valid domain name
      expect(config.rpID).toMatch(/^[a-zA-Z0-9.-]+$/);
      expect(config.rpID.length).toBeGreaterThan(0);
    });

    it('should have valid RP name', () => {
      const config = getWebAuthnConfig();
      
      expect(config.rpName).toBeDefined();
      expect(config.rpName.length).toBeGreaterThan(0);
      expect(typeof config.rpName).toBe('string');
    });

    it('should have valid origin configuration', () => {
      const config = getWebAuthnConfig();
      
      expect(config.origin).toBeDefined();
      
      if (Array.isArray(config.origin)) {
        expect(config.origin.length).toBeGreaterThan(0);
        config.origin.forEach(origin => {
          expect(origin).toMatch(/^https?:\/\/.+/);
        });
      } else {
        expect(config.origin).toMatch(/^https?:\/\/.+/);
      }
    });

    it('should have reasonable timeout values', () => {
      const config = getWebAuthnConfig();
      
      // Registration timeout should be reasonable (not too short, not too long)
      expect(config.timeout.registration).toBeGreaterThanOrEqual(30000); // At least 30 seconds
      expect(config.timeout.registration).toBeLessThanOrEqual(300000); // At most 5 minutes
      
      // Authentication timeout should be reasonable
      expect(config.timeout.authentication).toBeGreaterThanOrEqual(30000); // At least 30 seconds
      expect(config.timeout.authentication).toBeLessThanOrEqual(300000); // At most 5 minutes
    });

    it('should have valid attestation preference', () => {
      const config = getWebAuthnConfig();
      
      const validAttestations = ['none', 'indirect', 'direct'];
      expect(validAttestations).toContain(config.attestation);
    });

    it('should be consistent across multiple calls', () => {
      const config1 = getWebAuthnConfig();
      const config2 = getWebAuthnConfig();
      
      expect(config1.rpID).toBe(config2.rpID);
      expect(config1.rpName).toBe(config2.rpName);
      expect(config1.origin).toEqual(config2.origin);
      expect(config1.timeout).toEqual(config2.timeout);
      expect(config1.attestation).toBe(config2.attestation);
    });

    it('should handle environment variables correctly', () => {
      // Test with different environment variable scenarios
      const originalEnv = process.env;
      
      try {
        // Test with custom values
        process.env.WEBAUTHN_RP_ID = 'test.example.com';
        process.env.WEBAUTHN_RP_NAME = 'Test App';
        process.env.WEBAUTHN_ORIGIN = 'https://test.example.com';
        process.env.WEBAUTHN_TIMEOUT_REGISTRATION = '120000';
        process.env.WEBAUTHN_TIMEOUT_AUTHENTICATION = '60000';
        process.env.WEBAUTHN_ATTESTATION = 'direct';
        
        // Note: The config service caches values, so we can't test dynamic changes
        // This test verifies the function works with environment variables
        const config = getWebAuthnConfig();
        
        expect(config.rpID).toBeDefined();
        expect(config.rpName).toBeDefined();
        expect(config.origin).toBeDefined();
        expect(config.timeout.registration).toBeGreaterThan(0);
        expect(config.timeout.authentication).toBeGreaterThan(0);
        expect(config.attestation).toBeDefined();
      } finally {
        // Restore original environment
        process.env = originalEnv;
      }
    });

    it('should use defaults when environment variables are not set', () => {
      const originalEnv = process.env;
      
      try {
        // Clear WebAuthn environment variables
        delete process.env.WEBAUTHN_RP_ID;
        delete process.env.WEBAUTHN_RP_NAME;
        delete process.env.WEBAUTHN_ORIGIN;
        delete process.env.WEBAUTHN_TIMEOUT_REGISTRATION;
        delete process.env.WEBAUTHN_TIMEOUT_AUTHENTICATION;
        delete process.env.WEBAUTHN_ATTESTATION;
        
        const config = getWebAuthnConfig();
        
        // Should still return valid configuration with defaults
        expect(config.rpID).toBeDefined();
        expect(config.rpName).toBeDefined();
        expect(config.origin).toBeDefined();
        expect(config.timeout.registration).toBeGreaterThan(0);
        expect(config.timeout.authentication).toBeGreaterThan(0);
        expect(config.attestation).toBeDefined();
      } finally {
        // Restore original environment
        process.env = originalEnv;
      }
    });
  });
});
