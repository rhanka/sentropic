/**
 * Native (editable) XY scatter chart injection for xlsx workbooks.
 *
 * `exceljs` can read but cannot WRITE charts, so we post-process the workbook
 * zip produced by exceljs and inject the OOXML chart part directly:
 *   - xl/charts/chart1.xml                  (the c:chartSpace scatter chart)
 *   - xl/charts/_rels/chart1.xml.rels       (empty rels for the chart)
 *   - xl/drawings/drawing1.xml              (anchors the chart on the sheet)
 *   - xl/drawings/_rels/drawing1.xml.rels   (drawing -> chart relationship)
 *   - xl/worksheets/_rels/sheet<N>.xml.rels (sheet -> drawing relationship)
 *   - the sheet xml gets a <drawing r:id="..."/> element
 *   - [Content_Types].xml gets chart + drawing overrides
 *
 * The chart references the quadrant sheet's value/complexity cell ranges, so it
 * stays fully editable in Excel/LibreOffice (no rasterized image).
 */

import JSZip from 'jszip';

export type ScatterChartSpec = {
  /** Display name of the worksheet holding the data (must match exceljs sheet name). */
  sheetName: string;
  /** Number of data rows (excluding the header row at row 1). */
  rowCount: number;
  title: string;
  xAxisTitle: string;
  yAxisTitle: string;
  /** 1-based column index holding the series point names. */
  nameCol: number;
  /** 1-based column index for X values. */
  xCol: number;
  /** 1-based column index for Y values. */
  yCol: number;
};

const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CHART_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const DRAWING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawing+xml';

/** Convert a 1-based column index to its spreadsheet letter (1 -> A, 27 -> AA). */
function colLetter(index: number): string {
  let n = index;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** XML-escape a worksheet name for use inside a formula reference. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a sheet-qualified range reference, quoting the sheet name when it
 * contains characters that require quoting (spaces, punctuation, etc.).
 */
function rangeRef(sheetName: string, col: number, fromRow: number, toRow: number): string {
  const letter = colLetter(col);
  const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName);
  const sheetPart = needsQuote
    ? `'${sheetName.replace(/'/g, "''")}'`
    : sheetName;
  const ref = `${sheetPart}!$${letter}$${fromRow}:$${letter}$${toRow}`;
  return escapeXml(ref);
}

function buildChartXml(spec: ScatterChartSpec): string {
  const firstDataRow = 2;
  const lastDataRow = Math.max(firstDataRow, spec.rowCount + 1);
  const count = Math.max(0, spec.rowCount);

  const nameRange = rangeRef(spec.sheetName, spec.nameCol, firstDataRow, lastDataRow);
  const xRange = rangeRef(spec.sheetName, spec.xCol, firstDataRow, lastDataRow);
  const yRange = rangeRef(spec.sheetName, spec.yCol, firstDataRow, lastDataRow);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escapeXml(spec.title)}</a:t></a:r></a:p></c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:scatterChart>
        <c:scatterStyle val="marker"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:strRef><c:f>${nameRange}</c:f></c:strRef></c:tx>
          <c:spPr>
            <a:ln w="28575"><a:noFill/></a:ln>
          </c:spPr>
          <c:marker>
            <c:symbol val="circle"/>
            <c:size val="7"/>
          </c:marker>
          <c:dLbls>
            <c:showLegendKey val="0"/>
            <c:showVal val="0"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="0"/>
            <c:showBubbleSize val="0"/>
          </c:dLbls>
          <c:xVal>
            <c:numRef>
              <c:f>${xRange}</c:f>
              <c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${count}"/></c:numCache>
            </c:numRef>
          </c:xVal>
          <c:yVal>
            <c:numRef>
              <c:f>${yRange}</c:f>
              <c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${count}"/></c:numCache>
            </c:numRef>
          </c:yVal>
          <c:smooth val="0"/>
        </c:ser>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:scatterChart>
      <c:valAx>
        <c:axId val="111111111"/>
        <c:scaling><c:orientation val="minMax"/><c:min val="0"/><c:max val="100"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:title>
          <c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escapeXml(spec.xAxisTitle)}</a:t></a:r></a:p></c:rich></c:tx>
          <c:overlay val="0"/>
        </c:title>
        <c:crossAx val="222222222"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="222222222"/>
        <c:scaling><c:orientation val="minMax"/><c:min val="0"/><c:max val="100"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:title>
          <c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escapeXml(spec.yAxisTitle)}</a:t></a:r></a:p></c:rich></c:tx>
          <c:overlay val="0"/>
        </c:title>
        <c:crossAx val="111111111"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="r"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

function buildDrawingXml(): string {
  // Anchor the chart to the right of the data table (cols F..P, rows 1..22).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>26</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="PrioritizationChart"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

const DRAWING_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`;

const CHART_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"/>`;

/**
 * Locate the workbook-relative path of the worksheet whose display name matches
 * `sheetName`, by reading workbook.xml + workbook.xml.rels.
 */
async function resolveSheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) {
    throw new Error('xlsx_chart: workbook.xml or rels missing');
  }

  // Find the r:id of the sheet by display name.
  const sheetRegex = /<sheet\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  let rId: string | null = null;
  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    const tag = match[0];
    const nameAttr = /name="([^"]*)"/.exec(tag)?.[1];
    const idAttr = /r:id="([^"]*)"/.exec(tag)?.[1];
    if (nameAttr != null && unescapeXml(nameAttr) === sheetName && idAttr) {
      rId = idAttr;
      break;
    }
  }
  if (!rId) {
    throw new Error(`xlsx_chart: sheet "${sheetName}" not found in workbook.xml`);
  }

  const relRegex = new RegExp(`<Relationship\\b[^>]*Id="${rId}"[^>]*/>`);
  const relTag = relRegex.exec(relsXml)?.[0];
  const target = relTag ? /Target="([^"]*)"/.exec(relTag)?.[1] : null;
  if (!target) {
    throw new Error(`xlsx_chart: relationship ${rId} target not found`);
  }
  const normalized = target.replace(/^\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function addContentTypeOverrides(contentTypes: string): string {
  const overrides =
    `<Override PartName="/xl/charts/chart1.xml" ContentType="${CHART_CONTENT_TYPE}"/>` +
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${DRAWING_CONTENT_TYPE}"/>`;
  // Insert before the closing tag of the Types element.
  return contentTypes.replace(
    /<\/Types>\s*$/,
    `${overrides}</Types>`
  );
}

/**
 * Inject a native scatter chart into the given xlsx buffer.
 * Returns a new buffer; the original is not mutated.
 */
export async function injectScatterChart(
  xlsxBuffer: Buffer,
  spec: ScatterChartSpec
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(xlsxBuffer);

  const sheetPath = await resolveSheetPath(zip, spec.sheetName);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    throw new Error(`xlsx_chart: worksheet part ${sheetPath} missing`);
  }
  const sheetBaseName = sheetPath.split('/').pop()!; // e.g. sheet3.xml
  const sheetXml = await sheetFile.async('string');

  // 1) Chart part + rels.
  zip.file('xl/charts/chart1.xml', buildChartXml(spec));
  zip.file('xl/charts/_rels/chart1.xml.rels', CHART_RELS);

  // 2) Drawing part + rels.
  zip.file('xl/drawings/drawing1.xml', buildDrawingXml());
  zip.file('xl/drawings/_rels/drawing1.xml.rels', DRAWING_RELS);

  // 3) Worksheet -> drawing relationship.
  const sheetRelsPath = `xl/worksheets/_rels/${sheetBaseName}.rels`;
  const existingSheetRels = await zip.file(sheetRelsPath)?.async('string');
  const drawingRelId = nextRelId(existingSheetRels);
  const drawingRelationship = `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  if (existingSheetRels) {
    zip.file(
      sheetRelsPath,
      existingSheetRels.replace(/<\/Relationships>\s*$/, `${drawingRelationship}</Relationships>`)
    );
  } else {
    zip.file(
      sheetRelsPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${drawingRelationship}</Relationships>`
    );
  }

  // 4) Add <drawing r:id="..."/> to the worksheet xml (must be last child of <worksheet>).
  if (!/<drawing\b/.test(sheetXml)) {
    const drawingEl = `<drawing r:id="${drawingRelId}"/>`;
    const updatedSheetXml = sheetXml.replace(/<\/worksheet>\s*$/, `${drawingEl}</worksheet>`);
    zip.file(sheetPath, updatedSheetXml);
  }

  // 5) Content-type overrides.
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) {
    throw new Error('xlsx_chart: [Content_Types].xml missing');
  }
  zip.file('[Content_Types].xml', addContentTypeOverrides(contentTypes));

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  return out;
}

/** Compute the next free relationship id (rIdN) given an existing rels xml. */
function nextRelId(relsXml?: string): string {
  if (!relsXml) return 'rId1';
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const max = ids.length ? Math.max(...ids) : 0;
  return `rId${max + 1}`;
}
