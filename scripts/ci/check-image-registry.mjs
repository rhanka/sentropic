import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';

// Construct the retired hostname so this guard cannot match itself.
const forbidden = ['rg', 'fr-par', 'scw', 'cloud'].join('.');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const violations = files.filter(file => lstatSync(file).isFile()
  && readFileSync(file, 'utf8').replace(/\\+(?=\.)/g, '').includes(forbidden));
for (const file of violations) console.error(`Forbidden image registry reference: ${file}`);
if (violations.length) process.exit(1);
console.log(`Image registry guard: PASS (${files.length} tracked files, including hidden paths)`);
