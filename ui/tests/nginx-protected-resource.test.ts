import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const conf = readFileSync(resolve(__dirname, '../nginx/default.conf'), 'utf8');
const block = (header: RegExp): string => {
  const start = conf.search(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = conf.indexOf('{', start);
  const close = conf.indexOf('\n    }', open);
  return conf.slice(open, close);
};

describe('nginx RFC 9728 protected resource metadata location', () => {
  const prm = block(/location ~ "\^\/\\\.well-known\/oauth-protected-resource/);

  it('rewrites the host-root PRM path onto the API mount and proxies to the api service', () => {
    expect(prm).toContain('rewrite ^ /api/v1/mcp/.well-known/oauth-protected-resource break;');
    expect(prm).toContain('proxy_pass http://api:8787;');
  });

  it('keeps the same single proxy hop provenance as /api/v1/', () => {
    expect(prm).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(prm).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(prm).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
  });

  it('is read-only (no state-changing method reaches the API through it)', () => {
    expect(prm).toContain('limit_except GET HEAD OPTIONS { deny all; }');
  });
});
