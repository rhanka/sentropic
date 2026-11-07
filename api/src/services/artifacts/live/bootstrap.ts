/**
 * Trusted pod bootstrap program for `builderPod` / `createArtifactLiveService({ bootstrap })`: the pod spec runs
 * it as `node --input-type=module -e <program>` on the approved image digest (no shell, no exec fallback).
 * It embeds only public material: the supervisor's Ed25519 SPKI public key (W3 `supervisorPublicKey`), the
 * frozen recipes and the host environment built from zero. The private key never leaves the API.
 */
import { AGENT_SOURCE } from './bootstrap-agent';
import { SERVER_SOURCE } from './bootstrap-server';
import { LiveError } from './records';
import {
  BUILD_RECIPE, INSTALL_RECIPE, LIVE_PREBUNDLE_SCRIPT, LIVE_RECIPE, LIVE_UPSTREAM_PORT, PREBUNDLE_RECIPE, artifactEnvironment,
} from './recipes';

/** DER SPKI of an Ed25519 key: the fixed 12-byte prefix, then the 32-byte key, base64-encoded. */
const ED25519_SPKI = /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/;
/** Linux MAX_ARG_STRLEN (128 KiB) bounds one argv string; keep a margin. */
export const MAX_BOOTSTRAP_BYTES = 120 * 1024;

export function bootstrapConfig(publicKey: string) {
  if (!ED25519_SPKI.test(publicKey)) throw new LiveError('builder_unavailable');
  return { PUBLIC_KEY: publicKey, CONTROL_PORT: 5173, UPSTREAM_PORT: LIVE_UPSTREAM_PORT, ENV: artifactEnvironment(),
    RECIPES: { install: INSTALL_RECIPE, prebundle: PREBUNDLE_RECIPE, prebundleScript: LIVE_PREBUNDLE_SCRIPT,
      live: LIVE_RECIPE, build: BUILD_RECIPE } };
}
export function createBootstrapSource(publicKey: string) {
  const source = `${AGENT_SOURCE}${SERVER_SOURCE}\nawait startBootstrap(${JSON.stringify(bootstrapConfig(publicKey))});\n`;
  if (Buffer.byteLength(source) > MAX_BOOTSTRAP_BYTES) throw new LiveError('builder_unavailable');
  return source;
}
