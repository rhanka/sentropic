import { createHash } from 'node:crypto';
import { GitForgeError } from '../server/git-port.js';
import type { GitForgeContext } from '../server/git-port.js';
import { githubBytes } from './github-http.js';
import type { GitHubFetch } from './github-http.js';

const packet = (text: string) => {
  const data = Buffer.from(text); return Buffer.concat([Buffer.from((data.length + 4).toString(16).padStart(4, '0')), data]);
};
/** Smart HTTP old-id/new-id update, not REST's fast-forward-only approximation to CAS. */
export async function githubReceivePack(fetcher: GitHubFetch, context: GitForgeContext,
  branch: string, expectedSha: string, commitSha: string): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const pack = Buffer.from('5041434b0000000200000000', 'hex'); // Version 2, zero objects: REST already uploaded them.
  const body = Buffer.concat([packet(`${expectedSha} ${commitSha} ${ref}\0report-status\n`), Buffer.from('0000'),
    pack, createHash('sha1').update(pack).digest()]);
  let bytes: Uint8Array;
  try {
    bytes = await githubBytes(fetcher, `https://github.com/${context.locator}.git/git-receive-pack`, {
      method: 'POST', headers: {
        authorization: `Basic ${Buffer.from(`x-access-token:${context.token}`).toString('base64')}`,
        'content-type': 'application/x-git-receive-pack-request', accept: 'application/x-git-receive-pack-result',
      }, body,
    }, 64 * 1024);
  } catch { throw new GitForgeError('unknown'); }
  const result = Buffer.from(bytes); const lines: string[] = []; let offset = 0;
  while (offset < result.length) {
    const header = result.subarray(offset, offset + 4).toString('ascii');
    if (!/^[0-9a-f]{4}$/.test(header)) throw new GitForgeError('unknown');
    const length = parseInt(header, 16); offset += 4;
    if (length === 0) break;
    if (length < 4 || offset + length - 4 > result.length) throw new GitForgeError('unknown');
    lines.push(result.subarray(offset, offset + length - 4).toString('utf8').replace(/\n$/, '')); offset += length - 4;
  }
  if (lines[0] !== 'unpack ok') throw new GitForgeError('unknown');
  if (lines.length === 2 && lines[1] === `ok ${ref}`) return;
  if (lines.length === 2 && lines[1].startsWith(`ng ${ref} `)) throw new GitForgeError('conflict');
  throw new GitForgeError('unknown');
}
