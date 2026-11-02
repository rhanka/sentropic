import { execSync } from 'node:child_process';
export function sh(cmd: string) {
  return execSync(cmd, { encoding: 'utf8' });
}
