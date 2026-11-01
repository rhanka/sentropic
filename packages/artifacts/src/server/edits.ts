/**
 * Parity P0 — small old/new edits on publish.
 *
 * Edits apply to the current release's text files without resending the
 * whole file set. `oldStr` must occur exactly once in the file text; any
 * other count (or an unknown/non-text path) raises a typed `edit_mismatch`
 * before anything is staged, so a failed call changes nothing. The edited
 * files then become the new release through the same commit path.
 */
import { ArtifactOperationError } from './failures.js';

export interface EditableFile {
  readonly path: string;
  readonly mimeType: string;
  /** Decoded text for text mime types; undefined for binary files (not editable). */
  text?: string;
  readonly bytes: Uint8Array;
}

export interface EditOperation {
  readonly path: string;
  readonly oldStr: string;
  readonly newStr: string;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Apply edits to a copy of the file list. Throws ArtifactOperationError
 * ('edit_mismatch') on the first violation; the input files are never mutated.
 */
export function applyEdits(files: readonly EditableFile[], edits: readonly EditOperation[]): EditableFile[] {
  const result = files.map((file) => ({ ...file }));
  for (const edit of edits) {
    const file = result.find((entry) => entry.path === edit.path);
    if (file === undefined || file.text === undefined) {
      throw new ArtifactOperationError('edit_mismatch', { edit: { path: edit.path, occurrences: -1 } });
    }
    const occurrences = countOccurrences(file.text, edit.oldStr);
    if (occurrences !== 1) {
      throw new ArtifactOperationError('edit_mismatch', { edit: { path: edit.path, occurrences } });
    }
    file.text = file.text.slice(0, file.text.indexOf(edit.oldStr)) + edit.newStr +
      file.text.slice(file.text.indexOf(edit.oldStr) + edit.oldStr.length);
  }
  return result;
}
