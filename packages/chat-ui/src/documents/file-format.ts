import type { ChatGeneratedFileCard } from './types.js';

export function getGeneratedFileFormatLabel(
  format: ChatGeneratedFileCard['format'],
): string {
  return typeof format === 'string' && format.trim().length > 0
    ? format.trim().toUpperCase()
    : 'FILE';
}
