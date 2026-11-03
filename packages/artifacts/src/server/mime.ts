/**
 * Canonical text-mime pattern shared by publication input rules and source
 * reads. Leaf module: both `http.ts` and `server/source-read.ts` import it
 * without an import cycle.
 */
export const TEXT_MIME_PATTERN = '^(?:text/[a-z0-9!#$&^_.+-]+|application/(?:javascript|ecmascript|json|xml|[a-z0-9!#$&^_.+-]+\\+(?:json|xml))|image/svg\\+xml)(?![\\s\\S])';
export const TEXT_MIME_RE = new RegExp(TEXT_MIME_PATTERN);
