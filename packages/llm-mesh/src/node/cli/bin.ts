#!/usr/bin/env node
// @sentropic/llm-mesh/node/cli/bin.ts
//
// Dedicated executable entry point for the `llm-mesh-enroll` bin
// (package.json `bin`). It runs unconditionally: npm exposes the bin as a
// symlink named `llm-mesh-enroll`, so a suffix guard on `argv[1]` would
// no-op. Library consumers import `run` from `./enroll-cli.js` instead.

import { argv, exit } from 'node:process';
import { EXIT_CODES, defaultWriters } from './enroll-args.js';
import { run } from './enroll-cli.js';

run(argv.slice(2)).then(
  (code) => exit(code),
  () => {
    defaultWriters().err(JSON.stringify({ status: 'error', code: EXIT_CODES.probeFailed }));
    exit(EXIT_CODES.probeFailed);
  },
);
