import { describe, expect, it } from 'vitest';
import { dataPlaneFromEnv, type CustodyIssuer } from '../src/data-plane';
import { testTls } from './data-plane-tls';
import { liveHeaders } from '../src/live';
import { d7AdmittedPath, viteAdmittedPath, liveFromEnv } from '../src/live-config';
import type { LiveRoute } from '../src/live';
import { X509Certificate } from 'node:crypto';
import { combineAbortSignals } from '../src/abort-signals';

describe('data-plane and CSP configuration', () => {
  it.each([0, 1])('should compose cancellation from source %s with its reason', index => {
    const sources = [new AbortController(), new AbortController()];
    const signal = combineAbortSignals(sources.map(source => source.signal));
    sources[index].abort('cancelled'); expect(signal.aborted).toBe(true); expect(signal.reason).toBe('cancelled');
    const alreadyAborted = combineAbortSignals(sources.map(source => source.signal));
    expect(alreadyAborted.aborted).toBe(true); expect(alreadyAborted.reason).toBe('cancelled');
  });
  it('should generate certificates with a valid X.509 time window', () => {
    const tls = testTls();
    expect(Date.parse(new X509Certificate(tls.ca).validTo)).toBeGreaterThan(Date.now());
  });
  it('should retain the k8s backend by default and fail closed on missing issuer or invalid selection', () => {
    expect(dataPlaneFromEnv({})).toBeUndefined();
    expect(dataPlaneFromEnv({ APP_ARTIFACT_SANDBOX_BACKEND: 'k8s' })).toBeUndefined();
    expect(() => dataPlaneFromEnv({ APP_ARTIFACT_SANDBOX_BACKEND: 'typo' })).toThrow();
    expect(() => dataPlaneFromEnv({ APP_ARTIFACT_SANDBOX_BACKEND: 'execution-node' })).toThrow('issuer required');
  });
  it('should refuse incomplete TLS and cleartext or credential-bearing node URLs', () => {
    const issuer = {} as CustodyIssuer;
    const { env } = testTls();
    for (const url of ['http://node', 'https://user:password@node', 'https://node/path', 'https://node/?a=1']) {
      expect(() => dataPlaneFromEnv({ ...env, SANDBOX_NODE_URL: url }, issuer)).toThrow('SANDBOX_NODE_URL');
    }
    for (const name of ['SANDBOX_MTLS_DATA_PLANE_CERT_B64', 'SANDBOX_MTLS_DATA_PLANE_KEY_B64', 'SANDBOX_MTLS_CA_CERT_B64']) {
      expect(() => dataPlaneFromEnv({ ...env, [name]: '' }, issuer)).toThrow(name);
    }
    expect(() => dataPlaneFromEnv({ ...env, SANDBOX_MTLS_DATA_PLANE_CERT_B64: env.SANDBOX_MTLS_CA_CERT_B64 }, issuer)).toThrow('TLS credentials');
  });
  it('should change only worker-src in the pre-authorized D7-A profile', () => {
    const args: [string, number, string, string, string[]] = ['text/html', 10, 'https://artifact.example', 'session', []];
    const base = liveHeaders(...args); const d7 = liveHeaders(...args, 'D7-A');
    expect(base['content-security-policy']).toContain("worker-src 'none'");
    expect(d7).toEqual({ ...base, 'content-security-policy': base['content-security-policy']
      .replace("worker-src 'none'", "worker-src 'self' blob:") });
    expect(() => liveFromEnv({ APP_ARTIFACT_LIVE_ENABLED: '1', APP_ARTIFACT_LIVE_CSP_PROFILE: 'typo' }, 'content.example')).toThrow('CSP_PROFILE');
  });
  it('should admit the MapLibre worker URL query only in D7-A', async () => {
    const route = {} as LiveRoute; const query = new URLSearchParams('worker&url');
    expect(await viteAdmittedPath(route, '/node_modules/maplibre/worker.js', query)).toBe(false);
    expect(await d7AdmittedPath(route, '/node_modules/maplibre/worker.js', query)).toBe(true);
    for (const type of ['classic', 'module']) {
      const workerFile = new URLSearchParams(`worker_file&type=${type}`);
      expect(await d7AdmittedPath(route, '/src/worker.ts', workerFile)).toBe(true);
      expect(await viteAdmittedPath(route, '/src/worker.ts', workerFile)).toBe(false);
    }
    expect(await d7AdmittedPath(route, '/src/worker.ts', new URLSearchParams('worker_file&type=unknown'))).toBe(false);
    for (const value of ['worker', 'worker=shared&url', 'worker&worker&url', 'worker&url&secret=1']) {
      expect(await d7AdmittedPath(route, '/src/main.ts', new URLSearchParams(value))).toBe(false);
    }
  });
});
