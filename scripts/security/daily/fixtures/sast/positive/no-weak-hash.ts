import { createHash } from 'node:crypto';
export function legacy(input: string) {
  return createHash('md5').update(input).digest('hex');
}
