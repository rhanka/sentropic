import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGitHubForge } from '../src/adapters/github-forge.js';
import { githubReceivePack } from '../src/adapters/github-receive-pack.js';
import type { GitHubFetch } from '../src/adapters/github-http.js';

const context = { locator: 'owner/repo', token: 'fake-only-lease' };
const oldSha = 'a'.repeat(40); const nextSha = 'b'.repeat(40); const branch = 'artifact/p/human/app';
const packet = (line: string) => (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line;
const status = (line: string) => packet('unpack ok\n') + packet(`${line}\n`) + '0000';
const fetchMock = (body: unknown, code = 200) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: code }));

describe('GitHub forge transport (fake HTTP only)', () => {
  it('should transmit the expected old SHA and new SHA in one receive-pack update', async () => {
    const fetcher = fetchMock(status(`ok refs/heads/${branch}`));
    await githubReceivePack(fetcher as GitHubFetch, context, branch, oldSha, nextSha);
    const [url, init] = vi.mocked(fetcher as GitHubFetch).mock.calls[0];
    expect(url).toBe('https://github.com/owner/repo.git/git-receive-pack');
    const body = Buffer.from(init!.body as Uint8Array);
    expect(body.toString()).toContain(`${oldSha} ${nextSha} refs/heads/${branch}\0report-status\n`);
    const pack = Buffer.from('5041434b0000000200000000', 'hex');
    expect(body.subarray(-32)).toEqual(Buffer.concat([pack, createHash('sha1').update(pack).digest()]));
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(body.toString()).not.toContain('force');
  });
  it('should return a typed conflict on an old-SHA refusal', async () => {
    await expect(githubReceivePack(fetchMock(status(`ng refs/heads/${branch} stale info`)) as GitHubFetch,
      context, branch, oldSha, nextSha)).rejects.toMatchObject({ code: 'conflict' });
  });
  it.each(['bad packet', packet('unpack ok\n'), status('ok refs/heads/foreign')])('should leave malformed acknowledgements indeterminate', async body => {
    await expect(githubReceivePack(fetchMock(body) as GitHubFetch, context, branch, oldSha, nextSha)).rejects.toMatchObject({ code: 'unknown' });
  });
  it('should hide provider response bodies and transport errors', async () => {
    const forge = createGitHubForge(fetchMock({ message: 'sensitive-driver-text' }, 500) as GitHubFetch);
    await expect(forge.resolve(context, 'main')).rejects.toMatchObject({ message: 'unavailable' });
    const failing = vi.fn(async () => { throw new Error('sensitive-driver-text'); });
    await expect(createGitHubForge(failing as GitHubFetch).resolve(context, 'main')).rejects.toMatchObject({ message: 'unavailable' });
  });
  it('should refuse truncated trees instead of silently dropping paths', async () => {
    const forge = createGitHubForge(fetchMock({ sha: oldSha, truncated: true, tree: [] }) as GitHubFetch);
    await expect(forge.tree(context, oldSha)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('should verify blob bytes against their git object id', async () => {
    const bytes = Buffer.from('source'); const id = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    const forge = createGitHubForge(fetchMock({ sha: id, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length }) as GitHubFetch);
    expect(await forge.blob(context, id)).toEqual(bytes);
    await expect(forge.blob(context, oldSha)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('should preserve authorship and all changes without a REST ref PATCH', async () => {
    const fetcher = fetchMock({ sha: nextSha }); const forge = createGitHubForge(fetcher as GitHubFetch);
    await forge.createTree(context, oldSha, [{ path: 'ui/a', text: 'hello', mode: '100644' }, { path: 'ui/b', text: null, mode: '100755' }]);
    await forge.createCommit(context, { parentSha: oldSha, treeSha: nextSha, message: 'Update',
      author: { name: 'Human', email: 'human@noreply.test' }, committer: { name: 'App', email: 'app@noreply.test' } });
    const calls = vi.mocked(fetcher as GitHubFetch).mock.calls;
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({ base_tree: oldSha,
      tree: [{ path: 'ui/a', content: 'hello' }, { path: 'ui/b', sha: null }] });
    expect(JSON.parse(calls[1][1]!.body as string)).toMatchObject({ parents: [oldSha], author: { name: 'Human' }, committer: { name: 'App' } });
    expect(calls.every(([, init]) => init?.method === 'POST')).toBe(true);
  });
});
