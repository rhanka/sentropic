#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { resolve } from 'path';

const testType = process.argv[2];

if (!testType) {
  console.error('Usage: tsx scripts/test-runner.ts <test-type>');
  console.error('Test types: smoke, api, ai, queue, unit');
  process.exit(1);
}

// Get TEST_SCOPE from environment
const testScope = process.env.TEST_SCOPE;

// Define test patterns for each type
const testPatterns: Record<string, string[]> = {
  smoke: ['tests/smoke'],
  api: ['tests/api'],
  ai: ['tests/ai/*-sync.test.ts', 'tests/ai/*-async.test.ts'],
  queue: ['tests/queue'],
  unit: ['tests/unit']
};

// Build vitest command
const vitestArgs = ['run'];

  // If TEST_SCOPE is provided, use it as a filter pattern
  if (testScope) {
    // For unit tests, TEST_SCOPE can be a file pattern like "admin-registration" or "auth/*"
    if (testType === 'unit' && testScope) {
      // Handle both simple names and glob patterns
      if (testScope.includes('*')) {
        vitestArgs.push(`tests/unit/${testScope}.test.ts`);
      } else {
        vitestArgs.push(`tests/unit/${testScope}.test.ts`);
      }
    } else {
    // For other test types, just append the scope
    vitestArgs.push(...testPatterns[testType]);
    vitestArgs.push('--reporter', 'verbose');
    vitestArgs.push('--run');
    vitestArgs.push('--bail', '1');
    if (testScope !== '*') {
      vitestArgs.push(testScope);
    }
  }
} else {
  // No scope, run all tests for the type
  vitestArgs.push(...testPatterns[testType]);
}

console.log(`🧪 Running ${testType} tests${testScope ? ` with scope: ${testScope}` : ''}`);
console.log(`Command: vitest ${vitestArgs.join(' ')}`);

// Run vitest
const vitest = spawn('vitest', vitestArgs, {
  stdio: 'inherit',
  cwd: process.cwd()
});

vitest.on('close', (code) => {
  process.exit(code || 0);
});

vitest.on('error', (error) => {
  console.error('Failed to start vitest:', error);
  process.exit(1);
});
