/**
 * Canonical text-mime pattern shared by publication input rules and source
 * reads, plus the generic MIME ceiling and byte validation (files parity
 * LOT 1). Leaf module: `http.ts`, `server/source-read.ts`, `server/uploads.ts`
 * and `profile/index.ts` import it without an import cycle.
 *
 * The ceiling is the generic server maximum: a profile `mimeTypes` list must
 * be a subset of it (checked at profile compile time). Validation at commit
 * (upload commit and inline publish alike): magic bytes for binary types,
 * strict UTF-8 for text types, and a script/handler/external-reference-free
 * SVG. Declared type stays authoritative at serve time because it was
 * verified against the bytes at commit (sniffing stays banned).
 */
export const TEXT_MIME_PATTERN = '^(?:text/[a-z0-9!#$&^_.+-]+|application/(?:javascript|ecmascript|json|xml|[a-z0-9!#$&^_.+-]+\\+(?:json|xml))|image/svg\\+xml)(?![\\s\\S])';
export const TEXT_MIME_RE = new RegExp(TEXT_MIME_PATTERN);

/**
 * Generic MIME ceiling (server maximum). Profiles may only narrow it.
 * No executables, no archives: the posture rests on this closed allowlist
 * plus magic-byte verification, declared-type serving with `nosniff` on the
 * single-label content origin, and sandbox CSP on SVG/PDF.
 */
export const SERVER_MIME_CEILING: readonly string[] = Object.freeze([
  'text/html', 'text/css', 'text/javascript', 'application/json',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'image/svg+xml', 'image/x-icon',
  'application/pdf',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
  'video/mp4', 'video/webm',
  // J1.1a: bound application assets. Served bytes can never compile without
  // `wasm-unsafe-eval`, which no served policy carries.
  'application/wasm',
  'application/x-protobuf',
]);

/**
 * J1.1a — generic extension to MIME map (binding J1.0 relay). `.geojson`
 * serves as `application/json`, `.mjs` as `text/javascript` and `.woff2` as
 * `font/woff2`; `.wasm` and `.pbf` stay mapped as the owner asked. Every
 * value stays inside the server ceiling.
 */
export const EXTENSION_TO_MIME: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.pbf': 'application/x-protobuf',
});

/** MIME type for a manifest path by extension, case-insensitive, undefined off-map. */
export function mimeTypeForPath(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return EXTENSION_TO_MIME[path.slice(dot).toLowerCase()];
}

/** True when the MIME type is inside the generic ceiling. */
export function isWithinMimeCeiling(mimeType: string): boolean {
  return (SERVER_MIME_CEILING as readonly string[]).includes(mimeType);
}

/** Magic-byte signatures checked for binary types before any pin or release. */
const MAGIC_BYTES: Readonly<Record<string, readonly (readonly number[])[]>> = Object.freeze({
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP checked below
  'image/avif': [[0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]], // ftypavif
  'image/x-icon': [[0x00, 0x00, 0x01, 0x00]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  'font/woff': [[0x77, 0x4f, 0x46, 0x46]], // wOFF
  'font/woff2': [[0x77, 0x4f, 0x46, 0x32]], // wOF2
  'application/wasm': [[0x00, 0x61, 0x73, 0x6d]], // \0asm
  'font/ttf': [[0x00, 0x01, 0x00, 0x00]],
  'font/otf': [[0x4f, 0x54, 0x54, 0x4f]], // OTTO
  'video/mp4': [[0x66, 0x74, 0x79, 0x70]], // ftyp (brand checked loosely: isom/iso2/mp41/mp42/avc1/dash/msdh/m4v...)
  'video/webm': [[0x1a, 0x45, 0xdf, 0xa3]], // EBML
});

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** True for the RIFF....WEBP container (bytes 0-3 RIFF, 8-11 WEBP). */
function isWebp(bytes: Uint8Array): boolean {
  return hasMagic(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 &&
    hasMagic(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
}

/** True for an ISO-BMFF ftyp box whose major brand is an mp4 family brand. */
function isMp4(bytes: Uint8Array): boolean {
  if (!hasMagic(bytes, [0x66, 0x74, 0x79, 0x70]) || bytes.length < 12) return false;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return /^(isom|iso2|mp41|mp42|mp4v|avc1|dash|msdh|msix|m4v|m4a|3gp)/.test(brand);
}

/** True for an ISO-BMFF ftyp box whose major brand is avif/avis. */
function isAvif(bytes: Uint8Array): boolean {
  if (!hasMagic(bytes, [0x66, 0x74, 0x79, 0x70]) || bytes.length < 12) return false;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return brand === 'avif' || brand === 'avis';
}

const SVG_FORBIDDEN_RE = /<script|\son[a-z]+\s*=|href\s*=\s*["'](?!#)|xlink:href\s*=\s*["'](?!#)/i;

/**
 * Validate file bytes against the declared MIME type. Throws on mismatch;
 * callers map the failure to `verification_failed` (422) with no pin and no
 * release. Text types must decode as strict UTF-8; SVG must be XML text
 * without scripts, event handlers or external references.
 */
export function validateFileBytes(mimeType: string, bytes: Uint8Array): void {
  if (!isWithinMimeCeiling(mimeType)) throw new Error(`MIME type outside the server ceiling: ${mimeType}`);
  if (TEXT_MIME_RE.test(mimeType)) {
    if (mimeType === 'image/svg+xml') {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('SVG is not strict UTF-8');
      }
      if (!/<svg[\s>]/i.test(text)) throw new Error('SVG has no root <svg> element');
      if (SVG_FORBIDDEN_RE.test(text)) {
        throw new Error('SVG contains a script, event handler or external reference');
      }
      return;
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`text type ${mimeType} is not strict UTF-8`);
    }
    return;
  }
  if (mimeType === 'image/webp') {
    if (!isWebp(bytes)) throw new Error('webp magic bytes mismatch');
    return;
  }
  if (mimeType === 'image/avif') {
    if (!isAvif(bytes)) throw new Error('avif magic bytes mismatch');
    return;
  }
  if (mimeType === 'video/mp4') {
    if (!isMp4(bytes)) throw new Error('mp4 magic bytes mismatch');
    return;
  }
  // Opaque protobuf has no magic: any bytes pass (the ceiling allowlist and
  // the serving policy without `wasm-unsafe-eval` stay the guards).
  if (mimeType === 'application/x-protobuf') return;
  const magics = MAGIC_BYTES[mimeType];
  if (magics === undefined) throw new Error(`no magic-byte rule for ${mimeType}`);
  if (!magics.some((magic) => hasMagic(bytes, magic))) {
    throw new Error(`${mimeType} magic bytes mismatch`);
  }
}
