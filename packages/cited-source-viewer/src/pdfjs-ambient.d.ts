/**
 * Ambient module declarations for the pdf.js peer dependency.
 *
 * The package typecheck is hermetic: `pdfjs-dist` is a PEER dependency that is
 * only ever loaded dynamically at runtime (first PDF payload), so its real
 * type surface is not required at build time. The engine's own structural
 * types (`PdfJsModuleLike` & co in `pdfEngine.ts`) are the typed surface.
 * These declarations are scoped to THIS package's compilation — consumers
 * resolve `pdfjs-dist` against the real installed types.
 */

declare module "pdfjs-dist" {
  const pdfjsModule: unknown;
  export = pdfjsModule;
}

declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  /** Vite `?url` asset import: the bundled worker URL. */
  const url: string;
  export default url;
}
