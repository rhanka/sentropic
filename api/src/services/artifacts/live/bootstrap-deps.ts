/**
 * Pod agent section: W2 offline clean install (W3 `install { recipe, runId, source, cache, tarballs }`).
 * - `source` is the staged source tree, placed in a fresh /tmp/install (no node_modules, .npmrc or .yarnrc).
 * - `cache` carries the trusted-cache tarballs; each is re-verified against its SRI and stored at npm's
 *   content-addressed path in /tmp/npm-cache. A lockfile entry without a staged literal integrity refuses
 *   with `integrity` before npm runs, so the install never depends on a fetch.
 * - Then the frozen `npm ci --offline --ignore-scripts` runs in /tmp/install with the host environment.
 * The supervisor exports the result with `snapshot { root: 'dependencies' }` (bootstrap-procs.ts).
 */
export const DEPENDENCY_OPS_SOURCE = String.raw`
AGENT_SECTIONS.push(function dependencyOps(ctx) {
  const { state, at } = ctx;
  const INSTALL_DIR = '/tmp/install';
  const CONTENT = '/tmp/npm-cache/_cacache/content-v2/';
  const SRI = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;
  ctx.resets.push(['/tmp', () => { state.installed = false; }]);
  state.installed = false;
  async function fileDigest(algo, path) {
    const hash = agentHash(algo);
    const handle = await agentFs.open(path, 'r');
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); }
    finally { await handle.close(); }
    return hash.digest();
  }
  async function stageTarballs(cache, tarballs) {
    const set = await ctx.commitTransfer(cache.transfer, cache.treeDigest, 'npm-cache');
    const staged = new Set();
    try {
      const byPath = new Map(set.files.map((f) => [f.path, f]));
      if (!Array.isArray(tarballs) || tarballs.length !== byPath.size) agentFail('integrity', 'integrity_missing');
      for (const tarball of tarballs) {
        agentRecord(tarball, ['path', 'integrity']);
        const file = byPath.get(tarball.path); byPath.delete(tarball.path);
        const match = SRI.exec(typeof tarball.integrity === 'string' ? tarball.integrity : '');
        if (!file || !match) agentFail('integrity', 'integrity_missing');
        const expected = Buffer.from(match[2], 'base64');
        if (!(await fileDigest(match[1], at(file.staged))).equals(expected)) agentFail('integrity', 'integrity_mismatch');
        staged.add(tarball.integrity);
        const hex = expected.toString('hex');
        const target = at(CONTENT + match[1] + '/' + hex.slice(0, 2) + '/' + hex.slice(2, 4) + '/' + hex.slice(4));
        if (await agentFs.lstat(target).catch(agentMissing)) continue;
        await agentFs.mkdir(agentPath.dirname(target), { recursive: true });
        await agentFs.chmod(at(file.staged), 0o444);
        await agentFs.rename(at(file.staged), target);
      }
    } finally { await set.dispose(); }
    return staged;
  }
  async function requireCovered(staged) {
    let lock = null;
    try { lock = JSON.parse(await agentFs.readFile(at(INSTALL_DIR + '/package-lock.json'), 'utf8')); } catch { agentFail('failed', 'lockfile_missing'); }
    if (!lock || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) agentFail('failed', 'invalid_lockfile');
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || !entry || typeof entry !== 'object' || entry.link === true || typeof entry.resolved !== 'string'
        || !/^https?:\/\//.test(entry.resolved)) continue;
      if (typeof entry.integrity !== 'string' || !staged.has(entry.integrity)) agentFail('integrity', 'integrity_missing');
    }
  }
  ctx.define('install', ['recipe', 'runId', 'source', 'cache', 'tarballs'], async ({ recipe, runId, source, cache, tarballs }) => {
    if (recipe !== 'install' || typeof runId !== 'string' || !AGENT_ID.test(runId)) agentFail('failed', 'invalid_args');
    agentArgs(source, ['transfer', 'treeDigest']); agentArgs(cache, ['transfer', 'treeDigest']);
    if (state.installed) agentFail('failed', 'already_installed');
    if (!(await ctx.terminateAll())) agentFail('failed', 'tree_survived');
    if (await agentFs.lstat(at(INSTALL_DIR)).catch(agentMissing)) agentFail('failed', 'duplicate_path');
    state.installed = true;
    const set = await ctx.commitTransfer(source.transfer, source.treeDigest, 'install');
    try {
      const paths = set.files.map((f) => agentSourcePath(f.path));
      if (!paths.includes('package.json') || !paths.includes('package-lock.json')) agentFail('failed', 'lockfile_missing');
      for (const file of set.files) await ctx.place(file, INSTALL_DIR);
    } finally { await set.dispose(); }
    await requireCovered(await stageTarballs(cache, tarballs));
    return { exitCode: await ctx.runToExit(ctx.recipes.install, INSTALL_DIR) };
  });
});
`;
