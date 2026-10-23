/**
 * L-5d — content routing (spec-v8 §9 5d).
 *
 * Two origins per artifact, each with a single UUID label: the stable
 * origin `<artifactId>.<base>` follows the current release; the pinned
 * origin `<releaseId>.pinned.<base>` serves one immutable release. Two
 * concatenated UUIDs, extra labels, foreign bases and non-UUID labels
 * never route. Paths normalize to manifest file paths with an
 * `index.html` default; traversal, empty segments, backslashes and
 * encoded traversal never resolve (no history fallback hiding missing
 * assets). Service workers are detectable so the handler can deny them.
 */
import { isArtifactId } from '../contracts.js';

export type ContentOrigin =
  | { kind: 'stable'; artifactId: string }
  | { kind: 'pinned'; releaseId: string };

/** Parse a content Host header against the configured base domain. */
export function parseContentHost(host: string, baseDomain: string): ContentOrigin | undefined {
  const normalized = host.trim().toLowerCase().replace(/:\d+$/, '');
  const base = baseDomain.trim().toLowerCase();
  if (normalized.length === 0 || base.length === 0) return undefined;
  if (!normalized.endsWith(`.${base}`)) return undefined;
  const labels = normalized.slice(0, normalized.length - base.length - 1).split('.');
  if (labels.length === 1 && isArtifactId(labels[0])) {
    return { kind: 'stable', artifactId: labels[0] as string };
  }
  if (labels.length === 2 && labels[1] === 'pinned' && isArtifactId(labels[0])) {
    return { kind: 'pinned', releaseId: labels[0] as string };
  }
  return undefined;
}

/** Resolve a request path to a manifest file path (undefined = refuse). */
export function resolveContentPath(path: string): string | undefined {
  if (!path.startsWith('/') || path.includes('\\')) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (decoded !== path && (decoded.includes('..') || decoded.includes('\\'))) return undefined;
  const segments = decoded.split('/').filter((segment) => segment.length !== 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) return undefined;
  if (decoded.includes('//')) return undefined;
  if (segments.length === 0) return 'index.html';
  const joined = segments.join('/');
  return decoded.endsWith('/') ? `${joined}/index.html` : joined;
}

const SERVICE_WORKER_BASENAMES = new Set(['service-worker.js', 'sw.js']);

/** True for service-worker script paths (denied in this pilot). */
export function isServiceWorkerPath(filePath: string): boolean {
  const basename = filePath.split('/').pop() ?? '';
  return SERVICE_WORKER_BASENAMES.has(basename);
}
