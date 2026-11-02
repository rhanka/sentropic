import { digest } from '../daily/toolchain-contract.mjs';
import { requireContract as check, record, literal, list, path, hash, text } from './contract-schema.mjs';

const editSchema = record({ before: text, after: value => typeof value === 'string' });
const fileSchema = record({ path, beforeDigest: hash, afterDigest: hash, edits: list(editSchema) });
const patchSchema = record({ schemaVersion: literal(1), files: list(fileSchema) });
const envelopeSchema = record({ bytes: Buffer.isBuffer, digest: hash });

// Patches are data, never shell commands or hooks. Work on copies so a rejected
// later patch cannot leave partially modified source behind.
export function applyOrderedPatches(source, patches) {
  check(source && typeof source === 'object' && !Array.isArray(source), 'source files');
  check(Object.entries(source).every(([p, bytes]) => path(p) && Buffer.isBuffer(bytes)), 'source bytes/paths');
  check(list(envelopeSchema)(patches), 'ordered patches');
  const result = Object.fromEntries(Object.entries(source).map(([p, bytes]) => [p, Buffer.from(bytes)]));
  for (const envelope of patches) {
    check(digest(envelope.bytes) === envelope.digest, 'patch checksum');
    let patch;
    try { patch = JSON.parse(envelope.bytes); } catch { check(false, 'patch JSON'); }
    check(patchSchema(patch), 'patch schema');
    check(new Set(patch.files.map(file => file.path)).size === patch.files.length, 'duplicate patch targets');
    for (const file of patch.files) {
      const original = result[file.path];
      check(Object.hasOwn(result, file.path) && Buffer.isBuffer(original) &&
        digest(original) === file.beforeDigest, `source checksum: ${file.path}`);
      let content = original.toString('utf8');
      check(Buffer.from(content).equals(original), 'patch target UTF-8');
      for (const edit of file.edits) {
        const offset = content.indexOf(edit.before);
        check(offset >= 0 && content.indexOf(edit.before, offset + 1) === -1, 'unique patch context');
        check(edit.before !== edit.after, 'nonempty patch change');
        content = content.slice(0, offset) + edit.after + content.slice(offset + edit.before.length);
      }
      const output = Buffer.from(content);
      check(digest(output) === file.afterDigest, `patched checksum: ${file.path}`);
      result[file.path] = output;
    }
  }
  return result;
}
