// Verbatim readHostTuple excerpt from the retained L5 receiving validator.
// Evaluated by tuple.test.mjs; this excerpt is not a standalone CLI.
const HOST_TUPLE_FORMAT = 'e2-host-tuple/v1';
const isHex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const isSemver = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const isRelPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(value) && !value.includes('\0') && !value.includes(':');
const isIntegrity = (value) => typeof value === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value);

// Typed Node image: a digest-pinned reference `<name>@sha256:<64 hex>`
// whose major version parses as an integer and must equal exactly 24, so
// `node:240-…` never reads as Node 24.
const parseNodeImage = (value) => {
  const reference = typeof value === 'string' ? value.match(/^(.+)@sha256:([0-9a-f]{64})$/) : null;
  const tag = reference ? reference[1].match(/^node:(\d+)([.-].*)?$/) : null;
  const major = tag ? Number.parseInt(tag[1], 10) : NaN;
  const exact = tag && Number.isSafeInteger(major) && String(major) === tag[1] && major === 24;
  assert(reference && exact, 'nodeImage must be a Node 24 image by digest (<name>@sha256:<64 hex> with major version exactly 24)');
  return { name: reference[1], major, digest: reference[2] };
};

// The sentropic host delivery (backend closure, neutral contract, locks,
// Node 24 image digest, profiles) does not exist yet. It is required as an
// explicit file input, validated strictly, and bound through the E2
// provenance. Anything missing or malformed refuses fail-closed: no value
// is invented to stand in for the delivery.
function readHostTuple(path) {
  assert(typeof path === 'string' && path.length > 0, 'source-gap: host tuple is absent (sentropic backend/contract/lock/image/profile delivery pending); pass --host-tuple <e2-host-tuple-v1.json>, no value is invented');
  let bytes;
  try { bytes = readFileSync(resolve(path)); }
  catch { assert(false, `source-gap: host tuple is absent (unreadable file ${path}); pass --host-tuple <e2-host-tuple-v1.json>, no value is invented`); }
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); }
  catch { assert(false, 'source-gap: host tuple is incomplete (not JSON); refusing instead of inventing the sentropic delivery'); }
  const failures = [];
  if (!doc || typeof doc !== 'object') failures.push('not an object');
  else {
    if (doc.format !== HOST_TUPLE_FORMAT) failures.push('format must be e2-host-tuple/v1');
    const backend = doc.backend;
    if (!backend || typeof backend !== 'object' || typeof backend.name !== 'string' || backend.name.length === 0 || !isSemver(backend.version) || !isHex(backend.sourceHead, 40) || !isRelPath(backend.archive) || !isHex(backend.sha256, 64) || !isIntegrity(backend.integrity)) failures.push('backend closure is incomplete');
    const contract = doc.neutralContract;
    if (!contract || typeof contract !== 'object' || !isRelPath(contract.path) || !isSemver(contract.version) || !isHex(contract.sha256, 64)) failures.push('neutral contract is incomplete');
    if (!Array.isArray(doc.locks) || doc.locks.length === 0 || doc.locks.some((lock) => !lock || typeof lock !== 'object' || !isRelPath(lock.path) || !isHex(lock.sha256, 64))) failures.push('locks are incomplete');
    try { parseNodeImage(doc.nodeImage); } catch { failures.push('nodeImage must be a Node 24 image by digest'); }
    if (!Array.isArray(doc.profiles) || doc.profiles.length === 0 || doc.profiles.some((profile) => typeof profile !== 'string' || profile.length === 0)) failures.push('profiles are incomplete');
  }
  assert(failures.length === 0, `source-gap: host tuple is incomplete (${failures.join('; ')}); refusing instead of inventing the sentropic delivery`);
  // Facts, not names: every file the tuple references must exist next to the
  // tuple. Its bytes are read and hashed, and the hash must match the
  // declared digest, which the manifest then binds. A missing or tampered
  // file refuses fail-closed. Retain these exact verified bytes so the tuple
  // remains resolvable relative to its retained copy without source inputs.
  const root = dirname(resolve(path));
  const files = new Map();
  const bindFile = (declaredPath, declaredSha256, label) => {
    let fileBytes;
    try { fileBytes = readFileSync(resolve(root, declaredPath)); }
    catch { assert(false, `source-gap: host tuple references ${label} ${declaredPath} which does not exist; refusing instead of inventing the sentropic delivery`); }
    assert(sha256(fileBytes) === declaredSha256, `source-gap: host tuple ${label} ${declaredPath} bytes do not match the declared sha256 (tampered or stale); refusing instead of inventing the sentropic delivery`);
    files.set(posix.normalize(declaredPath), fileBytes);
    return fileBytes;
  };
  const backendBytes = bindFile(doc.backend.archive, doc.backend.sha256, 'backend archive');
  assert(integrity(backendBytes) === doc.backend.integrity, `source-gap: host tuple backend archive ${doc.backend.archive} bytes do not match the declared integrity; refusing instead of inventing the sentropic delivery`);
  bindFile(doc.neutralContract.path, doc.neutralContract.sha256, 'neutral contract');
  for (const lock of doc.locks) bindFile(lock.path, lock.sha256, 'lock');
  return { bytes, doc, files };
}
