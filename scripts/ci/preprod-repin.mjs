import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicImage } from './public-image.mjs';

// Continuous deployment follows main: deploy-preprod pins overlays/preprod to the API and UI
// images of the deployed commit. A kind published by the same main run is pinned to that
// publication; a kind this run did not publish (unchanged content) is pinned to the digest of
// the commit's own immutable content tag, published by an earlier main run. The committed pins
// are applied unchanged only under an explicit `# preprod-image-hold: <reason>` line.
const KINDS = ['api', 'ui'];
const HOLD = /^# preprod-image-hold: (\S.{0,199})$/m;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BLOCK = /\nimages:\n  - name: ghcr\.io\/rhanka\/sentropic-api\n    digest: sha256:[a-f0-9]{64}\n  - name: ghcr\.io\/rhanka\/sentropic-ui\n    digest: sha256:[a-f0-9]{64}\n$/;

function publishedDigest(kind, receipt, env) {
  const tag = env[`${kind.toUpperCase()}_VERSION`];
  if (receipt.kind !== kind || receipt.sourceSha !== env.GITHUB_SHA || receipt.runId !== env.GITHUB_RUN_ID
    || receipt.ref !== `ghcr.io/rhanka/sentropic-${kind}:${tag}` || !DIGEST.test(receipt.digest ?? '')
    || receipt.image !== `ghcr.io/rhanka/sentropic-${kind}@${receipt.digest}`) {
    throw Error(`Stale or foreign ${kind} publication`);
  }
  return receipt.digest;
}

export async function resolvePins(env, publications, resolve = publicImage) {
  const pins = {};
  for (const kind of KINDS) {
    const tag = env[`${kind.toUpperCase()}_VERSION`];
    if (!/^[a-f0-9]{6}$/.test(tag ?? '')) throw Error(`Missing ${kind} content tag`);
    const published = publications[kind] && publishedDigest(kind, publications[kind], env);
    const { digest } = await resolve(`ghcr.io/rhanka/sentropic-${kind}:${tag}`);
    if (!DIGEST.test(digest ?? '') || (published && digest !== published)) throw Error(`The ${kind} content tag differs from its publication`);
    pins[kind] = digest;
  }
  return pins;
}

export function repin(text, pins) {
  const hold = HOLD.exec(text);
  if (hold) return { text, hold: hold[1] };
  if (!BLOCK.test(text) || text.match(/^images:/gm)?.length !== 1) throw Error('Unexpected preprod images layout');
  return { text: text.replace(BLOCK, `\nimages:\n  - name: ghcr.io/rhanka/sentropic-api\n    digest: ${pins.api}\n`
    + `  - name: ghcr.io/rhanka/sentropic-ui\n    digest: ${pins.ui}\n`) };
}

export function loadPublications(dir, published) {
  const kinds = published.split(',').filter(Boolean);
  if (kinds.some(kind => !KINDS.includes(kind))) throw Error('Unknown published kind');
  return Object.fromEntries(kinds.map(kind => {
    const path = join(dir, `${kind}-image.published.json`);
    if (!existsSync(path)) throw Error(`Missing ${kind} publication receipt`);
    return [kind, JSON.parse(readFileSync(path, 'utf8'))];
  }));
}

if (process.argv[1]?.endsWith('/preprod-repin.mjs')) {
  const [file, dir] = process.argv.slice(2);
  const text = readFileSync(file, 'utf8');
  const held = HOLD.exec(text);
  if (held) console.log(`Preprod image hold kept: ${held[1]}`);
  else {
    const pins = await resolvePins(process.env, loadPublications(dir, process.env.PREPROD_PUBLISHED_KINDS ?? ''));
    writeFileSync(file, repin(text, pins).text);
    console.log(`Preprod repinned to the deployed commit: api ${pins.api}, ui ${pins.ui}`);
  }
}
