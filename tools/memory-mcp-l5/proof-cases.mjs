/** Frozen predecessor IDs identify complete suites, not renamed assertions. */
export function caseWasExecuted(catalog, file, result, id, expectedSourceSha256) {
  const assertions = Array.isArray(result?.assertionResults) ? result.assertionResults : [];
  if (assertions.some(a => a?.status === 'passed' && String(a.fullName || a.title).includes(id))) return true;
  const predecessor = catalog.id === 'P09' && ['P09.platform.predecessor-regressions',
    'P09.platform.immo-wire-fixtures', 'P09.mesh.predecessor-regressions'].includes(id);
  const immutableWire = catalog.id === 'P04' && id === 'P04.platform.wire-parity' &&
    file === 'packages/mcp-platform/tests/wire-parity.test.ts';
  return (predecessor || immutableWire) && catalog.fileCases?.[file]?.includes(id) &&
    /^[a-f0-9]{64}$/.test(expectedSourceSha256 || '') && result?.sourceSha256 === expectedSourceSha256 &&
    result?.status === 'passed' && assertions.length > 0 && assertions.every(a => a?.status === 'passed');
}
