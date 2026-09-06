import { Hono } from 'hono';

import type { DocumentsNamespacePorts } from './ports';

export const DOCUMENT_ROUTES = [
  ['GET', '/documents'],
  ['POST', '/documents'],
  ['POST', '/documents/google-drive'],
  ['GET', '/documents/:id'],
  ['DELETE', '/documents/:id'],
  ['GET', '/documents/:id/content'],
  ['POST', '/documents/:id/resync'],
  ['GET', '/use-cases/:id/docx'],
  ['POST', '/docx/generate'],
  ['GET', '/docx/jobs/:id/download'],
  ['GET', '/pptx/jobs/:id/download'],
  ['POST', '/xlsx/generate'],
  ['GET', '/xlsx/jobs/:id/download'],
] as const;

export const DOCUMENT_PATHS = [
  '/documents',
  '/documents/google-drive',
  '/documents/:id',
  '/documents/:id/content',
  '/documents/:id/resync',
  '/use-cases/:id/docx',
  '/docx/generate',
  '/docx/jobs/:id/download',
  '/pptx/jobs/:id/download',
  '/xlsx/generate',
  '/xlsx/jobs/:id/download',
] as const;

const assertDocumentsPorts = (ports: DocumentsNamespacePorts): void => {
  if (!ports.documents?.createRouter
    || !ports.docx?.createRouter
    || !ports.pptx?.createRouter
    || !ports.xlsx?.createRouter) {
    throw new Error('document product ports are unavailable');
  }
};

export const createDocumentsTransportRouter = (ports: DocumentsNamespacePorts): Hono => {
  assertDocumentsPorts(ports);
  return new Hono()
    .route('/documents', ports.documents.createRouter())
    .route('/', ports.docx.createRouter())
    .route('/', ports.pptx.createRouter())
    .route('/', ports.xlsx.createRouter());
};
