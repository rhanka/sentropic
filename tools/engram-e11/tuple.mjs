import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bindings, canonical, json, sha256, verifyTuple } from './bindings.mjs';
import { candidate } from './candidates.mjs';
import { validate } from './validate.mjs';
import { slots, handoff } from './slots.mjs';

export function build(root) {
  assert.equal(process.versions.node.split('.')[0], '24', 'E11 requires Node 24');
  const b = bindings(root);
  const observed = validate(b);
  for (const file of ['bindings.mjs', 'candidates.mjs', 'slots.mjs', 'validate.mjs', 'tuple.mjs', 'stage.mjs',
    'finalize.mjs', 'e11.mk', 'installed.sh', 'prepare.sh']) {
    const bytes = b.read(file);
    assert.equal(sha256(bytes), sha256(readFileSync(new URL(`./${file}`, import.meta.url))), `tool snapshot drift: ${file}`);
  }
  const body = b.read('pr803.md').toString();
  assert(body.includes('## E11 inputs (exact, from this head)'));
  const delivery = json(b.read('e10a3-delivery.json'));
  assert.equal(delivery.tarball.sha256, candidate.mesh.sha256);
  assert.equal(delivery.engram.integrity, candidate.engram.integrity);
  assert.equal(delivery.ci.status, 'completed');
  assert.equal(delivery.ci.conclusion, 'success');
  const lot6 = body.match(/## Lot 6 disposition \(#709\)\n([\s\S]*?)(?=\n## )/)?.[1];
  assert(lot6?.includes('missing source') && lot6.includes('option (a)'));
  const review = b.read('review-r3.md').toString();
  assert(review.includes('## Final E11 input list (exact)'));
  b.read('format.md');
  b.read('receiving-validator.mjs');
  const reservation = b.read('reservation.md').toString();
  assert(reservation.includes('New reserved stable release: `@sentropic/cluster-mesh@0.24.0`'));
  b.read('ci.json'); // Integration merge observation, independently retained.
  const runs = json(b.read('e10-ci.json')).workflow_runs;
  assert(Array.isArray(runs));
  const ci = runs.filter((run) => run.head_sha === 'cfd45de4d54651626e97113494b9d7bd108998c8' && run.event === 'pull_request' && run.name === 'CI')
    .map(({ id, head_sha, status, conclusion, html_url }) => ({ id, head: head_sha, status, conclusion, url: html_url }))
    .sort((a, z) => a.id - z.id);
  assert(ci.some((run) => run.status === 'completed' && run.conclusion === 'success'), 'E10 final-head CI is required');
  const cleanArchive = ({ member: _member, members: _members, ...data }) => data;
  const inputSlots = slots({ ...observed, engram: cleanArchive(observed.engram), mesh: cleanArchive(observed.mesh), ci, lot6 });
  assert.equal(inputSlots.length, 21);
  assert(inputSlots.every((slot) => b.files[slot.file]));
  const { mesh, c6, receipt } = observed;
  const tuple = { format: 'e2-host-tuple/v1', status: 'PENDING', mode: 'E2-installed-candidate',
    backend: { name: mesh.name, version: mesh.version, sourceHead: receipt.head,
      archive: mesh.file, sha256: mesh.sha256, integrity: mesh.integrity },
    engram: cleanArchive(observed.engram),
    neutralContract: { name: c6.name, version: c6.version, path: c6.path, sha256: c6.finalBytesSha256,
      contractDigest: c6.contractDigest, requiredArchiveMember: c6.declaration, status: 'VERIFIED-CANDIDATE',
      standaloneDeclarationSha256: c6.standaloneDeclarationSha256 },
    locks: ['consumer-lock.json', 'source/package-lock.json'].map((path) => ({ path, sha256: b.files[path].sha256 })),
    nodeImage: `node:24-bookworm-slim@${receipt.qualificationImage}`,
    profiles: [], requiredProfiles: receipt.requiredProfiles,
    finalGeneratorOwner: 'gr-conductor', provenance: { inputList: 'PR #821 producer/archive inputs and #803 lane, adapted for E2', inventory: 'Opus r3, 21 categories',
      snapshotHead: candidate.snapshotHead, formatEvidence: 'format.md', receivingValidator: 'receiving-validator.mjs',
      reviewDisposition: 'Historical dev.4/dev.5 anchors superseded by #821 dev.6 and published 0.21.3',
      excludedL5Candidate: 'L4 MCP 0.22.0 is separate L5 scope; plan E11 after E10 does not require it',
      packedSourceHead: json(b.read('pack-receipt.json')).head_sha },
    slots: inputSlots, handoff, files: b.files };
  return tuple;
}

export function report(tuple) {
  return { tupleSha256: sha256(canonical(tuple)), status: tuple.status,
    pending: [...tuple.slots.filter((s) => s.status === 'PENDING').map(({ id, name, reason }) => ({ id, name, reason })),
      ...Object.entries(tuple.handoff).map(([name, gate]) => ({ name: `handoff.${name}`, reason: gate.reason }))] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, root, output, ...flags] = process.argv.slice(2);
  assert(['generate', 'check'].includes(action) && root && output, 'usage: tuple.mjs generate|check INPUT_ROOT TUPLE [--require-final]');
  assert(flags.every((flag) => flag === '--require-final'), 'unknown flag');
  const tuple = build(root);
  if (action === 'generate') {
    assert.equal(flags.length, 0, 'preparation generator cannot emit a final tuple');
    writeFileSync(output, canonical(tuple));
  } else {
    const bytes = readFileSync(output);
    const actual = json(bytes);
    assert.equal(bytes.toString(), canonical(actual), 'noncanonical tuple bytes');
    verifyTuple(actual, tuple, flags.includes('--require-final'));
  }
  process.stdout.write(canonical(report(tuple)));
}
