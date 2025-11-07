/**
 * Debug buffer helper for E2E global setup
 * 
 * Usage:
 *   import { debug, displayDebugOnFailure } from '../helpers/debug-global-setup';
 *   
 *   try {
 *     debug('Step 1: Starting setup');
 *     await doSomething();
 *     debug('Step 1: Completed');
 *   } catch (err) {
 *     displayDebugOnFailure();
 *     throw err;
 *   }
 * 
 * The debug buffer is displayed only if an error occurs.
 */

// Store debug messages in a buffer
const debugBuffer: string[] = [];

/**
 * Log a debug message to the buffer
 * @param message - Debug message to log
 */
export function debug(message: string): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  debugBuffer.push(`[${timestamp}] ${message}`);
}

/**
 * Display debug buffer and clear it
 * Should be called before throwing an error
 */
export function displayDebugOnFailure(): void {
  if (debugBuffer.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('DEBUG BUFFER for Global Setup (failure occurred)');
    console.log('='.repeat(80));
    debugBuffer.forEach((msg) => console.log(msg));
    console.log('='.repeat(80) + '\n');
  }
  // Clear buffer after display
  debugBuffer.length = 0;
}

/**
 * Clear debug buffer without displaying
 * Useful for successful completion
 */
export function clearDebugBuffer(): void {
  debugBuffer.length = 0;
}

