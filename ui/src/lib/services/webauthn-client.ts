import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

/**
 * WebAuthn Client Service
 * 
 * Browser-side WebAuthn operations using @simplewebauthn/browser:
 * - Check browser support
 * - Start registration ceremony
 * - Start authentication ceremony
 * - Handle errors and user cancellation
 */

/**
 * Check if WebAuthn is supported in the current browser
 */
export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && 
         window.PublicKeyCredential !== undefined &&
         typeof window.PublicKeyCredential === 'function';
}

/**
 * Check if platform authenticator (biometric) is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    return false;
  }
  
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Start WebAuthn registration ceremony
 * 
 * @param options - Registration options from server
 * @returns Registration response to send to server
 * @throws Error if registration fails or user cancels
 */
export async function startWebAuthnRegistration(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }
  
  try {
    const credential = await startRegistration({ optionsJSON: options });
    return credential;
  } catch (error: any) {
    // Handle common error cases
    if (error.name === 'NotAllowedError') {
      throw new Error('Registration cancelled by user');
    }
    
    if (error.name === 'InvalidStateError') {
      throw new Error('This authenticator is already registered');
    }
    
    if (error.name === 'NotSupportedError') {
      throw new Error('This authenticator is not supported');
    }
    
    throw new Error(`Registration failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Start WebAuthn authentication ceremony
 * 
 * @param options - Authentication options from server
 * @returns Authentication response to send to server
 * @throws Error if authentication fails or user cancels
 */
export async function startWebAuthnAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<AuthenticationResponseJSON> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }
  
  try {
    const credential = await startAuthentication({ optionsJSON: options });
    return credential;
  } catch (error: any) {
    // Handle common error cases
    if (error.name === 'NotAllowedError') {
      throw new Error('Authentication cancelled by user');
    }
    
    if (error.name === 'InvalidStateError') {
      throw new Error('No matching authenticator found');
    }
    
    if (error.name === 'NotSupportedError') {
      throw new Error('This authenticator is not supported');
    }
    
    throw new Error(`Authentication failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get user-friendly error message for WebAuthn errors
 */
export function getWebAuthnErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  
  const message = error?.message || 'Unknown error';
  
  // Map technical errors to user-friendly messages
  const errorMap: Record<string, string> = {
    'Registration cancelled by user': 'Vous avez annulé l\'inscription',
    'Authentication cancelled by user': 'Vous avez annulé l\'authentification',
    'This authenticator is already registered': 'Cet appareil est déjà enregistré',
    'No matching authenticator found': 'Aucun appareil reconnu',
    'WebAuthn is not supported in this browser': 'Votre navigateur ne supporte pas WebAuthn',
  };
  
  return errorMap[message] || message;
}
