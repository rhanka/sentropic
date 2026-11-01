import { spawn } from 'node:child_process';
export function run(cmd: string, args: string[]) {
  return spawn(cmd, args, { shell: false });
}
