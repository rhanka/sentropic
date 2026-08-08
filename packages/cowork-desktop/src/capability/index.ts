/**
 * Desktop capability seam — barrel export.
 *
 * `DesktopCapabilityProvider` is the platform boundary for eyes (capture) and
 * hands (mouse/keyboard). The mock provider backs all unit tests; the Windows
 * provider lazy-loads native libs at runtime.
 */

export * from './types.js';
export * from './mock-provider.js';
export * from './windows-provider.js';
export * from './foreground-surface.js';
