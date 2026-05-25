import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractDocumentInfoFromDocument } from '../../src/services/document-text';

async function createWorkbookBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Budget" sheetId="1" r:id="rId1"/>
    <sheet name="Roadmap" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`,
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Department</t></si>
  <si><t>Q1</t></si>
  <si><t>Q2</t></si>
  <si><t>Support</t></si>
  <si><t>Sales</t></si>
  <si><t>Milestone</t></si>
  <si><t>Owner</t></si>
  <si><t>Launch</t></si>
  <si><t>Alice</t></si>
</sst>`,
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>120</v></c><c r="C2"><v>150</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>200</v></c><c r="C3"><v>225</v></c></row>
  </sheetData>
</worksheet>`,
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>5</v></c><c r="B1" t="s"><v>6</v></c></row>
    <row r="2"><c r="A2" t="s"><v>7</v></c><c r="B2" t="s"><v>8</v></c></row>
  </sheetData>
</worksheet>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

describe('document text extraction', () => {
  it('extracts readable text from every XLSX worksheet', async () => {
    const extracted = await extractDocumentInfoFromDocument({
      bytes: await createWorkbookBytes(),
      filename: 'planning.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(extracted.text).toContain('Sheet: Budget');
    expect(extracted.text).toContain('Department\tQ1\tQ2');
    expect(extracted.text).toContain('Support\t120\t150');
    expect(extracted.text).toContain('Sheet: Roadmap');
    expect(extracted.text).toContain('Milestone\tOwner');
    expect(extracted.text).toContain('Launch\tAlice');
    expect(extracted.metadata.title).toBe('planning.xlsx');
    expect(extracted.metadata.words).toBeGreaterThan(5);
  });
});
