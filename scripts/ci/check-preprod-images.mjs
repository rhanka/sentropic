import { execFileSync } from 'node:child_process';
import { publicImage } from './public-image.mjs';

export function deploymentImages(rendered) {
  const images = [...new Set([...rendered.matchAll(/^\s+(?:-\s+)?image:\s+(\S+)\s*$/gm)].map(m => m[1]))]
    .filter(image => image.includes('sentropic-'));
  if (images.length !== 2 || !['api', 'ui'].every(kind => images.some(image =>
    new RegExp(`^ghcr\\.io/rhanka/sentropic-${kind}@sha256:[a-f0-9]{64}$`).test(image)))) {
    throw Error('Expected one API and one UI immutable GHCR digest in the preprod overlay');
  }
  return images;
}

if (process.argv[1]?.endsWith('/check-preprod-images.mjs')) {
  const rendered = execFileSync('kubectl', ['kustomize', 'deploy/k8s/overlays/preprod'], { encoding: 'utf8' });
  for (const image of deploymentImages(rendered)) {
    const { digest } = await publicImage(image);
    console.log(`Verified anonymous preprod image: ${image} (${digest})`);
  }
}
