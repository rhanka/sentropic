/**
 * Text extraction helpers for document summarization.
 * MVP requirement: support pdf, docx, pptx, md.
 */
export async function extractTextFromDocument(params: {
  bytes: Uint8Array;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<string> {
  const mime = (params.mimeType || '').toLowerCase();
  const name = (params.filename || '').toLowerCase();

  const isMarkdown = mime === 'text/markdown' || name.endsWith('.md') || name.endsWith('.markdown');
  const isTextLike = mime.startsWith('text/') || mime.includes('json') || isMarkdown;

  if (isTextLike) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    return text;
  }

  // Office / PDF via officeparser@6
  // NOTE: officeparser has a brittle CLI detection that assumes process.argv[1] exists in some environments.
  if (!process.argv[1]) process.argv[1] = 'app';

  const mod = (await import('officeparser')) as unknown as {
    parseOffice: (file: unknown, config?: Record<string, unknown>) => Promise<unknown>;
  };

  const buf = Buffer.from(params.bytes);
  const ast = await mod.parseOffice(buf, { outputErrorToConsole: false });

  // v6 returns an AST with a toText() helper.
  const maybeAst = ast as { toText?: () => string } | null;
  if (maybeAst && typeof maybeAst.toText === 'function') {
    return maybeAst.toText();
  }

  // Fallbacks
  if (typeof ast === 'string') return ast;
  try {
    return JSON.stringify(ast);
  } catch {
    return String(ast ?? '');
  }
}


