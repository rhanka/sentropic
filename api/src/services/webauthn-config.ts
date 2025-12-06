import { env } from '../config/env';
import type {
  AttestationConveyancePreference,
  UserVerificationRequirement,
} from '@simplewebauthn/server';

/**
 * WebAuthn Relying Party Configuration
 * 
 * Centralizes all WebAuthn configuration for the application.
 * Used by registration and authentication services.
 */

export interface WebAuthnConfig {
  rpID: string;
  rpName: string;
  origin: string | string[];
  timeout: {
    registration: number;
    authentication: number;
  };
  attestation: AttestationConveyancePreference;
  userVerification: {
    admin: UserVerificationRequirement;
    editor: UserVerificationRequirement;
    guest: UserVerificationRequirement;
  };
}

/**
 * Get WebAuthn Relying Party configuration from environment
 */
export function getWebAuthnConfig(): WebAuthnConfig {
  return {
    // RP ID: domain without protocol/port (e.g., "top-ai-ideas.sent-tech.ca" or "localhost")
    rpID: env.WEBAUTHN_RP_ID || 'localhost',
    
    // RP Name: Human-readable name displayed to users
    rpName: env.WEBAUTHN_RP_NAME || 'Top AI Ideas',
    
    // Origin(s): Full URL(s) for validation (must match browser origin)
    origin: env.WEBAUTHN_ORIGIN 
      ? env.WEBAUTHN_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:8787'],
    
    // Timeouts in milliseconds
    timeout: {
      registration: parseInt(env.WEBAUTHN_TIMEOUT_REGISTRATION || '60000', 10),
      authentication: parseInt(env.WEBAUTHN_TIMEOUT_AUTHENTICATION || '300000', 10),
    },
    
    // Attestation: 'none' (default), 'indirect', or 'direct'
    // 'none' = no attestation verification (recommended for most use cases)
    attestation: (env.WEBAUTHN_ATTESTATION as AttestationConveyancePreference) || 'none',
    
    // User Verification requirements by role
    // 'required' = enforce UV (PIN/biometric), 'preferred' = request but allow fallback, 'discouraged' = don't request
    userVerification: {
      admin: 'required',     // Admins must use UV
      editor: 'preferred',   // Editors should use UV when available
      guest: 'preferred',    // Guests should use UV when available
    },
  };
}

/**
 * Get user verification requirement based on user role
 */
export function getUserVerificationRequirement(
  role: 'admin_app' | 'admin_org' | 'editor' | 'guest'
): UserVerificationRequirement {
  const config = getWebAuthnConfig();
  
  if (role === 'admin_app' || role === 'admin_org') {
    return config.userVerification.admin;
  }
  
  if (role === 'editor') {
    return config.userVerification.editor;
  }
  
  return config.userVerification.guest;
}

