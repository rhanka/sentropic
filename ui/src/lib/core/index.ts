/**
 * Core abstractions — barrel export.
 *
 * These modules decouple UI components from SvelteKit-specific imports ($app/*),
 * enabling the same ChatWidget code to run in both SvelteKit (web app) and
 * Chrome Extension (content script) environments.
 */

export * from './context-provider';
export * from './api-client';
export * from './navigation-adapter';
export * from './auth-bridge';
