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
