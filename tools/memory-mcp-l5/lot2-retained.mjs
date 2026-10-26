// Historical retention check. Never qualifies the current broker against old P3 bytes.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ANCILLARY, readInside, verifyPreCandidate, sha256 } from './precandidate.mjs';
import { P1_CONFIG_FILES, TOOLCHAIN_SNAPSHOT_FILES } from './build-inputs.mjs';
import { P3_SHA256 } from './lot2-manifest.mjs';
export function verifyRetainedP3(root, path) {
  const bytes = readInside(root, path);
  if (sha256(bytes) !== P3_SHA256) throw Error('retention: frozen P3 digest mismatch');
  const manifest = JSON.parse(bytes), stage = mkdtempSync(join(tmpdir(), 'l5-retained-'));
  try {
    const paths = new Set([path, path + '.sha256', 'Makefile', ...ANCILLARY, ...P1_CONFIG_FILES,
      ...TOOLCHAIN_SNAPSHOT_FILES, manifest.source.declaredLockSnapshot.path, ...manifest.artifacts.map(a => a.archive)]);
    for (const file of paths) {
      mkdirSync(dirname(join(stage, file)), { recursive: true }); writeFileSync(join(stage, file), readInside(root, file));
    }
    // The existing verifier validates this snapshot's digest, filename, closure and build inputs.
    writeFileSync(join(stage, 'package-lock.json'), readInside(root, manifest.source.declaredLockSnapshot.path));
    const report = verifyPreCandidate(stage, path);
    if (report.failures.length) throw Error(report.failures.join('\n'));
    return { retainedOnly: true, qualificationAccepted: false, manifestSha256: report.manifestSha256,
      retainedFiles: report.resolvedFiles.length, edges: report.edges.length };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyRetainedP3(process.cwd(), process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
