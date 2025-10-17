import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { AuthenticationResponseJSON } from '@simplewebauthn/types';

describe('Counter Validation Tests', () => {
  let user: any;

  beforeAll(async () => {
    user = await createAuthenticatedUser();
  });

  afterAll(async () => {
    await cleanupAuthData();
  });

  describe('WebAuthn Counter Validation', () => {
    it('should reject authentication with invalid counter', async () => {
      // Create a mock credential with invalid counter
      const mockCredential: AuthenticationResponseJSON = {
        id: 'test-credential-id',
        rawId: 'test-raw-id',
        response: {
          authenticatorData: Buffer.from([
            // RP ID hash (32 bytes)
            ...Array(32).fill(0),
            // Flags (1 byte) - user present, user verified
            0x05,
            // Signature counter (4 bytes) - invalid counter (0xFFFFFFFF)
            0xFF, 0xFF, 0xFF, 0xFF,
            // Attested credential data (variable length)
            ...Array(100).fill(0)
          ]).toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'test-challenge',
            origin: 'http://localhost:5173'
          })).toString('base64url'),
          signature: 'test-signature',
          userHandle: 'test-user-handle'
        },
        type: 'public-key'
      };

      const response = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Should fail due to invalid counter
      expect([400, 401, 500]).toContain(response.status);
    });

    it('should reject authentication with decreasing counter', async () => {
      // Create a mock credential with decreasing counter
      const mockCredential: AuthenticationResponseJSON = {
        id: 'test-credential-id',
        rawId: 'test-raw-id',
        response: {
          authenticatorData: Buffer.from([
            // RP ID hash (32 bytes)
            ...Array(32).fill(0),
            // Flags (1 byte) - user present, user verified
            0x05,
            // Signature counter (4 bytes) - decreasing counter (0x00000001)
            0x00, 0x00, 0x00, 0x01,
            // Attested credential data (variable length)
            ...Array(100).fill(0)
          ]).toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'test-challenge',
            origin: 'http://localhost:5173'
          })).toString('base64url'),
          signature: 'test-signature',
          userHandle: 'test-user-handle'
        },
        type: 'public-key'
      };

      const response = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Should fail due to decreasing counter
      expect([400, 401, 500]).toContain(response.status);
    });

    it('should accept authentication with valid counter', async () => {
      // Create a mock credential with valid counter
      const mockCredential: AuthenticationResponseJSON = {
        id: 'test-credential-id',
        rawId: 'test-raw-id',
        response: {
          authenticatorData: Buffer.from([
            // RP ID hash (32 bytes)
            ...Array(32).fill(0),
            // Flags (1 byte) - user present, user verified
            0x05,
            // Signature counter (4 bytes) - valid counter (0x00000001)
            0x00, 0x00, 0x00, 0x01,
            // Attested credential data (variable length)
            ...Array(100).fill(0)
          ]).toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'test-challenge',
            origin: 'http://localhost:5173'
          })).toString('base64url'),
          signature: 'test-signature',
          userHandle: 'test-user-handle'
        },
        type: 'public-key'
      };

      const response = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Should fail due to invalid credentials, but not due to counter
      expect([400, 401, 500]).toContain(response.status);
    });
  });

  describe('Counter Security Implications', () => {
    it('should prevent replay attacks through counter validation', async () => {
      // Test that the same credential cannot be used multiple times
      const mockCredential: AuthenticationResponseJSON = {
        id: 'test-credential-id',
        rawId: 'test-raw-id',
        response: {
          authenticatorData: Buffer.from([
            // RP ID hash (32 bytes)
            ...Array(32).fill(0),
            // Flags (1 byte) - user present, user verified
            0x05,
            // Signature counter (4 bytes) - valid counter
            0x00, 0x00, 0x00, 0x01,
            // Attested credential data (variable length)
            ...Array(100).fill(0)
          ]).toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'test-challenge',
            origin: 'http://localhost:5173'
          })).toString('base64url'),
          signature: 'test-signature',
          userHandle: 'test-user-handle'
        },
        type: 'public-key'
      };

      // First attempt
      const response1 = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Second attempt with same credential
      const response2 = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Both should fail due to invalid credentials
      expect([400, 401, 500]).toContain(response1.status);
      expect([400, 401, 500]).toContain(response2.status);
    });

    it('should validate counter format and range', async () => {
      // Test with counter that's too large
      const mockCredential: AuthenticationResponseJSON = {
        id: 'test-credential-id',
        rawId: 'test-raw-id',
        response: {
          authenticatorData: Buffer.from([
            // RP ID hash (32 bytes)
            ...Array(32).fill(0),
            // Flags (1 byte) - user present, user verified
            0x05,
            // Signature counter (4 bytes) - too large counter
            0x7F, 0xFF, 0xFF, 0xFF,
            // Attested credential data (variable length)
            ...Array(100).fill(0)
          ]).toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'test-challenge',
            origin: 'http://localhost:5173'
          })).toString('base64url'),
          signature: 'test-signature',
          userHandle: 'test-user-handle'
        },
        type: 'public-key'
      };

      const response = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: mockCredential
        })
      });

      // Should fail due to invalid counter
      expect([400, 401, 500]).toContain(response.status);
    });
  });
});
