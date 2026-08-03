/**
 * Portable auth — barrel export.
 *
 * Token lifecycle math (exp decode, refresh-skew, user normalization), the
 * storage seam, and the session/token transport client extracted from the
 * Chrome extension's `extension-auth.ts`.
 */

export * from './types.js';
export * from './token.js';
export * from './storage-adapter.js';
export * from './device-identity.js';
export * from './session-auth.js';
