/**
 * Core abstractions — barrel export.
 *
 * These modules decouple UI components from SvelteKit-specific imports ($app/*)
 * and from Chrome-extension globals (chrome.*), enabling the same code to run in
 * the SvelteKit web app, the Chrome extension content script, and the Cowork
 * desktop binary.
 */

export * from './context-provider.js';
export * from './api-client.js';
export * from './navigation-adapter.js';
export * from './chatwidget-handoff.js';
