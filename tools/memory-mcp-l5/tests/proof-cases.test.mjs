import { expect, it } from 'vitest';
import { caseWasExecuted } from '../proof-cases.mjs';
import { checkProofCommand } from '../receipt.mjs';

it('maps only complete source-bound predecessor families without renaming real assertions', () => {
  const id = 'P09.platform.predecessor-regressions', file = 'packages/mcp-platform/tests/request-identity.test.ts';
  const catalog = { id: 'P09', fileCases: { [file]: [id] } }, digest = 'a'.repeat(64);
  const row = { status: 'passed', sourceSha256: digest, assertionResults: [{ fullName: 'original frozen assertion', status: 'passed' }] };
  expect(caseWasExecuted(catalog, file, row, id, digest)).toBe(true);
  expect(row.assertionResults[0].fullName).toBe('original frozen assertion');
  expect(caseWasExecuted(catalog, file, row, id, 'b'.repeat(64))).toBe(false);
  expect(caseWasExecuted(catalog, file, { ...row, assertionResults: [] }, id, digest)).toBe(false);
  expect(caseWasExecuted(catalog, file, { ...row, assertionResults: [{ status: 'pending' }] }, id, digest)).toBe(false);
  expect(caseWasExecuted({ ...catalog, id: 'P05' }, file, row, 'P05.e4.canonical-fenced-store', digest)).toBe(false);
});

it('accepts the exact full qualifier and current isolated ENV without accepting scope or tuple overrides', () => {
  const command = 'make memory-l5-qualify ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/candidate-manifest.json CHECKPOINT=spec/evidence/memory-mcp-l5/r5-checkpoint.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5';
  expect(checkProofCommand(command, 'make memory-l5-tooling')).toBe(true);
  expect(checkProofCommand(command.replace('ENV=test-memory-l5', 'SCOPE=one ENV=test-memory-l5'), 'make memory-l5-tooling')).toBe(false);
  expect(checkProofCommand(command.replace('candidate-manifest.json', 'other.json'), 'make memory-l5-tooling')).toBe(false);
});
