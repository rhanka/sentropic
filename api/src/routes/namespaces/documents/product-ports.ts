import { documentsRouter } from './product-documents';
import { docxRouter } from './product-docx';
import { pptxRouter } from './product-pptx';
import { xlsxRouter } from './product-xlsx';
import type { DocumentsNamespacePorts } from './ports';

export const productDocumentsPorts: DocumentsNamespacePorts = {
  documents: { createRouter: () => documentsRouter },
  docx: { createRouter: () => docxRouter },
  pptx: { createRouter: () => pptxRouter },
  xlsx: { createRouter: () => xlsxRouter },
};
