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
  for (const file of ['bindings', 'candidates', 'slots', 'validate', 'tuple']) {
    const bytes = b.read(`${file}.mjs`);
    assert.equal(sha256(bytes), sha256(readFileSync(new URL(`./${file}.mjs`, import.meta.url))), `tool snapshot drift: ${file}`);
  }
  const body = b.read('pr803.md').toString();
  assert(body.includes('## E11 inputs (exact, from this head)'));
  assert(body.includes(candidate.mesh.sha256) && body.includes(candidate.qualifiedHead));
  assert(body.includes(candidate.anchors['receipt.json']));
  const lot6 = body.match(/## Lot 6 disposition \(#709\)\n([\s\S]*?)(?=\n## )/)?.[1];
  assert(lot6?.includes('missing source') && lot6.includes('option (a)'));
  const review = b.read('review-r3.md').toString();
  assert(review.includes('## Final E11 input list (exact)'));
  const reservation = b.read('reservation.md').toString();
  assert(reservation.includes('New reserved stable release: `@sentropic/cluster-mesh@0.24.0`'));
  const runs = json(b.read('ci.json')).workflow_runs;
  assert(Array.isArray(runs));
  const ci = runs.filter((run) => run.head_sha === candidate.snapshotHead && run.event === 'pull_request')
    .map(({ id, head_sha, status, conclusion, html_url }) => ({ id, head: head_sha, status, conclusion, url: html_url }))
    .sort((a, z) => a.id - z.id);
  const cleanArchive = ({ member: _member, members: _members, ...data }) => data;
  const inputSlots = slots({ ...observed, engram: cleanArchive(observed.engram), mesh: cleanArchive(observed.mesh), ci, lot6 });
  assert.equal(inputSlots.length, 21);
  assert(inputSlots.every((slot) => b.files[slot.file]));
  const tuple = { format: 'e2-host-tuple/v1', status: 'PENDING', mode: 'preparation-only',
    finalGeneratorOwner: 'gr-conductor', provenance: { inputList: 'PR #803 E11 inputs', inventory: 'Opus r3, 21 categories',
      snapshotHead: candidate.snapshotHead, reviewDisposition: 'r3 historical dev.4 anchors superseded by current dev.5 PR inputs' },
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
