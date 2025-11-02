import { test } from '@playwright/test';

/**
 * Debug buffer helper for E2E tests
 * 
 * Usage:
 *   import { debug, setupDebugBuffer } from '../helpers/debug';
 *   
 *   // Setup automatic buffer display on failure (call once per test file)
 *   setupDebugBuffer();
 *   
 *   test('my test', async ({ page }) => {
 *     debug('Step 1: Loading page');
 *     await page.goto('/');
 *     debug('Page loaded, checking element');
 *     // ... test code ...
 *   });
 * 
 * The debug buffer is automatically displayed only if the test fails.
 */

// Store debug buffers per test using test.info()
const debugBuffers = new Map<string, string[]>();

/**
 * Log a debug message to the buffer
 * @param message - Debug message to log
 */
export function debug(message: string): void {
  const testId = test.info().titlePath.join(' > ');
  if (!debugBuffers.has(testId)) {
    debugBuffers.set(testId, []);
  }
  const buffer = debugBuffers.get(testId)!;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  buffer.push(`[${timestamp}] ${message}`);
}

/**
 * Get debug buffer for current test
 */
export function getDebugBuffer(): string[] {
  const testId = test.info().titlePath.join(' > ');
  return debugBuffers.get(testId) || [];
}

/**
 * Clear debug buffer for current test
 */
export function clearDebugBuffer(): void {
  const testId = test.info().titlePath.join(' > ');
  debugBuffers.delete(testId);
}

/**
 * Setup automatic debug buffer display on test failure
 * Call this once in your test file (e.g., in a beforeEach or at the top level)
 */
export function setupDebugBuffer(): void {
  test.afterEach(async ({}, testInfo) => {
    const testId = testInfo.titlePath.join(' > ');
    const buffer = debugBuffers.get(testId);
    
    if (buffer && buffer.length > 0) {
      if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
        console.log('\n' + '='.repeat(80));
        console.log(`DEBUG BUFFER for: ${testId}`);
        console.log('='.repeat(80));
        buffer.forEach((msg) => console.log(msg));
        console.log('='.repeat(80) + '\n');
      }
      // Clear buffer after test completes
      debugBuffers.delete(testId);
    }
  });
}


