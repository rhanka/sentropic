#!/usr/bin/env node
import { runHarnessCli } from '../cli/run.js';

const code = runHarnessCli(process.argv.slice(2), (s) => process.stdout.write(s + '\n'));
process.exit(code);
