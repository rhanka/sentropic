import { digest, isDigest, requireEvidence } from './toolchain-contract.mjs';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /github_pat_[A-Za-z0-9_]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /xox[bap]-[A-Za-z0-9-]{8,}/,
];

const ALLOWED_LINK_ORIGINS = [
  'https://github.com/rhanka/sentropic/',
  'https://raw.githubusercontent.com/rhanka/sentropic/',
];

function scanStrings(value, location, hits) {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        hits.push({ location, reason: `synthetic secret pattern ${pattern.source}` });
        break;
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => scanStrings(entry, `${location}[${index}]`, hits));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) scanStrings(entry, `${location}.${key}`, hits);
  }
}

function checkFilenames(files, hits) {
  for (const file of files ?? []) {
    if (typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
      hits.push({ location: `files:${file}`, reason: 'malicious filename' });
    }
  }
}

export function quarantineScan(payload) {
  if (payload === null || typeof payload !== 'object') {
    return { safe: false, status: 'incomplete-scan', withheld: [{ location: 'payload', reason: 'invalid output' }] };
  }
  const withheld = [];
  scanStrings(payload, 'payload', withheld);
  checkFilenames(payload.files, withheld);
  if (withheld.length > 0) return { safe: false, status: 'incomplete-scan', withheld };
  return { safe: true, withheld: [] };
}

export function validatePublicLink(url) {
  if (ALLOWED_LINK_ORIGINS.some((origin) => url.startsWith(origin))) return [];
  return [`link ${url} is outside the fixed public origins`];
}

// ACT-L05 (r6 wave W2): L5-D bounded chunked transfer and L5-E measured
// transfer/storage bounds. The collector (deploy key) and the scan supervisor
// keep separate write permissions; nothing here performs a live upload.
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const REPORT_REF = 'refs/heads/security-reports';
export const REPORT_COLLECTOR = 'deploy-key';

// L5-D: a chunk set becomes admissible evidence only when every chunk digest
// matches, the count is exact, filenames are safe files and the manifest digest
// binds the ordered chunk digests. Altered, missing, partial, oversize, symlink
// or traversal entries refuse.
export function validateTransferManifest({ chunks, manifest, maxChunkBytes = MAX_CHUNK_BYTES, maxTotalBytes = MAX_TOTAL_BYTES }) {
  requireEvidence(manifest && manifest.schemaVersion === 1 && Number.isInteger(manifest.count) &&
    manifest.count > 0 && isDigest(manifest.manifestDigest), 'transfer manifest');
  requireEvidence(Array.isArray(chunks), 'chunk list');
  requireEvidence(chunks.length >= manifest.count, 'missing chunk');
  requireEvidence(chunks.length <= manifest.count, 'unexpected chunk');
  let total = 0;
  const ordered = [];
  for (const entry of chunks) {
    requireEvidence(entry && typeof entry.name === 'string' && !entry.name.includes('..') &&
      !entry.name.startsWith('/'), 'malicious chunk filename');
    requireEvidence(entry.type === 'file' && !entry.target, 'symlink chunk refuses');
    const bytes = Buffer.byteLength(entry.data ?? '');
    requireEvidence(bytes <= maxChunkBytes, 'chunk byte bound exceeded');
    requireEvidence(isDigest(entry.digest) && entry.digest === digest(entry.data ?? ''), 'altered chunk refuses');
    total += bytes;
    ordered.push(entry.digest);
  }
  requireEvidence(total <= maxTotalBytes, 'total transfer byte bound exceeded');
  requireEvidence(manifest.totalBytes === total, 'partial upload refuses');
  requireEvidence(digest(ordered.join('|')) === manifest.manifestDigest, 'manifest digest mismatch');
  return true;
}

// L5-D: the transfer receipt must come from the trusted collector, bind the
// exact producer run/attempt and stay separate from the scan writer. Forged,
// swapped or source-controlled receipts refuse.
export function validateTransferReceipt(receipt, { expectedProducer }) {
  requireEvidence(receipt && receipt.schemaVersion === 1, 'receipt schema');
  requireEvidence(receipt.collector === REPORT_COLLECTOR, 'only the deploy-key collector may publish');
  requireEvidence(receipt.scanRole && receipt.scanRole !== receipt.collector, 'collector and scan write permissions must remain separate');
  requireEvidence(receipt.sourceControlled !== true, 'source-controlled receipt refuses');
  requireEvidence(receipt.producer?.runId === expectedProducer.runId &&
    receipt.producer?.runAttempt === expectedProducer.runAttempt &&
    receipt.producer?.job === expectedProducer.job, 'swapped producer run/attempt refuses');
  const { receiptHash, ...body } = receipt;
  requireEvidence(isDigest(receiptHash) && receiptHash === digest(JSON.stringify(body)), 'forged receipt refuses');
  return true;
}

// L5-D: publish only when quarantine, manifest and receipt all pass. Any
// hostile or partial input yields incomplete-scan and publishes nothing.
export function publishEvidence({ payload, chunks, manifest, receipt, producer }) {
  const quarantine = quarantineScan(payload);
  if (!quarantine.safe) return { published: false, status: quarantine.status, withheld: quarantine.withheld, publishedPaths: [] };
  try {
    validateTransferManifest({ chunks, manifest });
    validateTransferReceipt(receipt, { expectedProducer: producer });
  } catch {
    return { published: false, status: 'incomplete-scan', publishedPaths: [] };
  }
  return { published: true, status: 'complete', publishedPaths: [...(receipt.publishedPaths ?? [])] };
}

// L5-E: record actual transfer/extraction/disk/storage use. Unknown
// entitlement, insufficient headroom or any paid-overage exposure refuses
// before the transfer starts.
export function validateTransferBudget({ transferredBytes, extractionBytes, diskBytes, storageBytes,
  entitlement, headroomBytes, paidOverageExposure }) {
  for (const value of [transferredBytes, extractionBytes, diskBytes, storageBytes, headroomBytes]) {
    requireEvidence(Number.isFinite(value) && value >= 0, 'measured byte counts required');
  }
  requireEvidence(entitlement === 'measured-no-overage', 'unknown entitlement refuses before transfer');
  requireEvidence(headroomBytes >= transferredBytes + extractionBytes + diskBytes + storageBytes,
    'insufficient headroom refuses before transfer');
  requireEvidence(paidOverageExposure === false, 'paid-overage exposure refuses before transfer');
  const measurement = { transferredBytes, extractionBytes, diskBytes, storageBytes,
    entitlement, headroomBytes, recordedAt: new Date().toISOString() };
  measurement.measurementHash = digest(JSON.stringify(measurement));
  return measurement;
}

// L5-E: public report storage is qualified independently of seat-store access.
export function validateReportStorageIndependence({ reportRef, seatStoreAccess }) {
  requireEvidence(reportRef === REPORT_REF, 'report ref must be the data-only security-reports branch');
  requireEvidence(seatStoreAccess === false, 'public report storage must not read the seat-store');
  return true;
}
