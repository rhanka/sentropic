import type { Hono } from 'hono';

export interface DocumentRouterPort {
  createRouter(): Hono;
}

export interface DocumentsNamespacePorts {
  readonly documents: DocumentRouterPort;
  readonly docx: DocumentRouterPort;
  readonly pptx: DocumentRouterPort;
  readonly xlsx: DocumentRouterPort;
}
