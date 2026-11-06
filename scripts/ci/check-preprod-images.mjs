import { execFileSync } from 'node:child_process';
import { publicImage } from './public-image.mjs';

const rendered = execFileSync('kubectl', ['kustomize', 'deploy/k8s/overlays/preprod'], { encoding: 'utf8' });
const images = [...new Set([...rendered.matchAll(/^\s+image:\s+(\S+)\s*$/gm)].map(m => m[1]))]
  .filter(image => image.includes('sentropic-'));
if (images.length !== 2) throw Error('Expected one API and one UI digest in the preprod overlay');
for (const image of images) {
  if (!/@sha256:[a-f0-9]{64}$/.test(image)) throw Error('Preprod deployment must use immutable manifest digests');
  const { digest } = await publicImage(image);
  console.log(`Verified anonymous preprod image: ${image} (${digest})`);
}
