import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readCandidateInput, verifyCandidateArchive } from '../candidate.mjs';
it('P08.packed.exports-inventory: exact archives expose every required installed entry', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const manifest = JSON.parse(readCandidateInput(root, process.env.ARTIFACT_MANIFEST));
  for (const artifact of manifest.artifacts) {
    const { pkg, files } = verifyCandidateArchive(root, artifact);
    if (artifact.role === 'broker') expect(Object.hasOwn(pkg.exports || {}, './memory-reference'), 'candidate broker must contain the qualified workflow reference').toBe(true);
    for (const entry of Object.values(pkg.exports || {})) {
      const targets = typeof entry === 'string' ? [entry] : Object.values(entry);
      for (const path of targets) expect(files.has(String(path).replace(/^\.\//, ''))).toBe(true);
    }
  }
});
