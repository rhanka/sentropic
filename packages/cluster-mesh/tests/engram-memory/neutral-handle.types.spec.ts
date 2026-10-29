import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('should accept the real PostgreSQL kernel and driver at the neutral boundary', () => {
  const fixture = fileURLToPath(new URL('./neutral-handle-types.ts', import.meta.url));
  const program = ts.createProgram([fixture], { strict: true, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
  expect(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
});
