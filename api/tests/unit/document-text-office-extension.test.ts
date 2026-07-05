import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocumentInfoFromDocument } from '../../src/services/document-text';

const WORDPROCESSINGML_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Regression for BUG-3 (document-summary "Échec" on real .docx).
 *
 * officeparser, when given a bare Buffer, delegates type detection to
 * `file-type` magic-byte sniffing. For real-world OOXML files (docx/pptx/xlsx
 * are ZIP containers) `file-type@22` regularly returns plain `zip`, and
 * officeparser then throws "Sorry, OfficeParser currently supports docx, pptx,
 * xlsx, ... files only. ... add support for zip files" — even though the file
 * IS a valid docx.
 *
 * The two bundled templates DEMONSTRABLY trip this: `file-type` classifies both
 * as `application/zip`. Before the fix, extraction throws for both. After the
 * fix (route through a temp file with the resolved extension), both extract.
 */
const TEMPLATES = ['executive-synthesis.docx', 'usecase-onepage.docx'];

describe('document text extraction — office extension routing (BUG-3)', () => {
  it('file-type byte-sniffing mis-detects the bundled docx templates as zip (proves the root cause)', async () => {
    const { fileTypeFromBuffer } = await import('file-type');
    for (const name of TEMPLATES) {
      const bytes = readFileSync(join(process.cwd(), 'templates', name));
      const type = await fileTypeFromBuffer(bytes);
      // This is the trigger condition: without our extension routing officeparser
      // would receive `ext: 'zip'` and reject the file.
      expect(type?.ext).toBe('zip');
    }
  });

  it('extracts text from real .docx files that defeat byte-sniffing', async () => {
    for (const name of TEMPLATES) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'templates', name)));
      const extracted = await extractDocumentInfoFromDocument({
        bytes,
        filename: name,
        mimeType: WORDPROCESSINGML_MIME,
      });
      expect(extracted.text.trim().length).toBeGreaterThan(80);
    }
  });

  it('routes on mime even when the filename has no extension', async () => {
    const bytes = new Uint8Array(
      readFileSync(join(process.cwd(), 'templates', 'executive-synthesis.docx')),
    );
    const extracted = await extractDocumentInfoFromDocument({
      bytes,
      filename: 'no-extension-here',
      mimeType: WORDPROCESSINGML_MIME,
    });
    expect(extracted.text.trim().length).toBeGreaterThan(80);
  });
});
