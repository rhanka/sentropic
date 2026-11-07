/**
 * Pod agent section: W2 offline dependency acquisition.
 * - `tarballs` stores trusted-cache bytes at npm's content-addressed path after re-verifying SRI.
 * - `install` runs the frozen `npm ci --offline` in a fresh /dependencies from host manifests only.
 * - `export` pages the installed regular files back to the trusted cache for its sealed receipt.
 * Materialization lives in bootstrap-materialize.ts.
 * Acquisition (`tarballs`, `install`, `export`) is refused once repository code ran in this pod.
 */
export const DEPENDENCY_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function dependencyOps(ctx) {
  const { state, at } = ctx;
  const DEP = { files: 65536, bytes: 536870912, exportFiles: 4096, exportBytes: 12582912, tarballs: 20000 };
  const CONTENT = '/tmp/npm-cache/_cacache/content-v2/';
  const reset = () => { state.installed = null; state.tarballs = 0; };
  ctx.resets.push(reset); reset();
  const trusted = () => { if (state.tainted || state.phase !== 'stopped') agentFail('failed', 'phase_refused'); };

  ctx.define('tarballs', ['entries'], async ({ entries }) => {
    trusted();
    if (!Array.isArray(entries) || entries.length === 0) agentFail('failed', 'invalid_args');
    if (state.tarballs + entries.length > DEP.tarballs) agentFail('limit', 'limit_exceeded');
    const prepared = [];
    for (const entry of entries) {
      agentRecord(entry, ['integrity', 'contentBase64']);
      const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(typeof entry.integrity === 'string' ? entry.integrity : '');
      if (!match) agentFail('failed', 'integrity_missing');
      const data = agentBytes(entry.contentBase64, AGENT_LIMITS.fileBytes);
      const expected = Buffer.from(match[2], 'base64');
      if (!agentHash(match[1]).update(data).digest().equals(expected)) agentFail('failed', 'integrity_mismatch');
      const hex = expected.toString('hex');
      prepared.push({ algo: match[1], expected, data,
        target: at(CONTENT + match[1] + '/' + hex.slice(0, 2) + '/' + hex.slice(2, 4) + '/' + hex.slice(4)) });
    }
    for (const item of prepared) {
      await agentFs.mkdir(agentPath.dirname(item.target), { recursive: true });
      try { await agentFs.writeFile(item.target, item.data, { flag: 'wx', mode: 0o444 }); }
      catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        if (!agentHash(item.algo).update(await agentFs.readFile(item.target)).digest().equals(item.expected)) {
          agentFail('failed', 'integrity_mismatch');
        }
      }
    }
    state.tarballs += prepared.length;
    return { stored: prepared.length };
  });

  async function listInstalled() {
    const out = []; let total = 0;
    const walk = async (rel) => {
      for (const name of (await agentFs.readdir(at('/dependencies/' + rel))).sort()) {
        const path = rel ? rel + '/' + name : name;
        const info = await agentFs.lstat(at('/dependencies/' + path));
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) { await walk(path); continue; }
        if (!info.isFile()) agentFail('failed', 'special_file');
        if (!path.split('/').includes('node_modules')) continue;
        total += info.size;
        if (info.size > AGENT_LIMITS.fileBytes || total > DEP.bytes || out.length >= DEP.files) agentFail('limit', 'limit_exceeded');
        out.push({ path, mode: info.mode & 0o111 ? 365 : 292, size: info.size });
      }
    };
    await walk('');
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  ctx.define('install', ['manifests'], async ({ manifests }) => {
    trusted();
    if (state.installed) agentFail('failed', 'already_installed');
    if (!Array.isArray(manifests) || manifests.length === 0 || manifests.length > 1024) agentFail('failed', 'invalid_args');
    const batch = new Map();
    for (const manifest of manifests) {
      agentRecord(manifest, ['path', 'contentBase64']);
      const path = agentSourcePath(manifest.path);
      if (path !== 'package-lock.json' && path !== 'package.json' && !path.endsWith('/package.json')) agentFail('failed', 'invalid_path');
      if (batch.has(path)) agentFail('failed', 'duplicate_path');
      batch.set(path, agentBytes(manifest.contentBase64, AGENT_LIMITS.fileBytes));
    }
    if (!batch.has('package.json') || !batch.has('package-lock.json')) agentFail('failed', 'lockfile_missing');
    for (const [path, data] of batch) {
      await agentFs.mkdir(agentPath.dirname(at('/dependencies/' + path)), { recursive: true });
      await agentFs.writeFile(at('/dependencies/' + path), data, { flag: 'wx', mode: 0o644 });
    }
    if (await ctx.runToExit(ctx.recipes.INSTALL, '/dependencies') !== 0) agentFail('failed', 'install_failed');
    state.installed = await listInstalled();
    return { files: state.installed.length, bytes: state.installed.reduce((n, f) => n + f.size, 0) };
  });
  ctx.define('export', ['offset'], async ({ offset }) => {
    trusted();
    const list = state.installed;
    if (!list) agentFail('failed', 'not_installed');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > list.length) agentFail('failed', 'invalid_args');
    const files = []; let bytes = 0; let index = offset;
    for (; index < list.length && files.length < DEP.exportFiles; index++) {
      const entry = list[index];
      if (files.length > 0 && bytes + entry.size > DEP.exportBytes) break;
      const data = await agentFs.readFile(at('/dependencies/' + entry.path));
      if (data.length !== entry.size) agentFail('failed', 'unstable_tree');
      bytes += data.length;
      files.push({ path: entry.path, type: 'file', mode: entry.mode, bytes: data.toString('base64') });
    }
    return { files, next: index < list.length ? index : null };
  });
});
`;
