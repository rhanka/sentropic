import { exec } from 'node:child_process';

export function runTestSeed(): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  return new Promise((resolve) => {
    exec('npx tsx src/scripts/seed-test-data.ts', { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stderr: stderr || error.message });
        return;
      }
      resolve({ ok: true, stdout });
    });
  });
}
