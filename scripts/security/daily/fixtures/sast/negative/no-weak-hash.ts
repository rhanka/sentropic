import { createHash } from 'node:crypto';
export function strong(input: string) {
  return createHash('sha256').update(input).digest('hex');
}
