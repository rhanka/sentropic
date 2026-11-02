import assert from 'node:assert/strict';
import test from 'node:test';
import { offlineGoEnvironment, proxyPathFromRetained, retainedProxyPath, verifyResolvedModules } from './offline-dependencies.mjs';

const module = { Path: 'github.com/go-jose/go-jose/v4', Version: 'v4.1.6',
  Sum: 'h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=',
  GoModSum: 'h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=' };
const sums = `${module.Path} ${module.Version} ${module.Sum}\n${module.Path} ${module.Version}/go.mod ${module.GoModSum}\n`;
const goMod = `module fixture\ngo 1.27.0\nrequire ${module.Path} ${module.Version}\n`;

test('should bind the resolved embedded dependency to reviewed source and module sums', () => {
  assert.deepEqual(verifyResolvedModules({ goMod, goSum: sums, modules: [module] }),
    { contractValid: true, productionAdmitted: false });
});

test('should refuse the OS-only source, missing embedded module, checksum substitution and replacements', () => {
  for (const mutate of [
    f => { f.goMod = f.goMod.replace('v4.1.6', 'v4.1.5'); },
    f => { f.modules = []; },
    f => { f.modules[0].Sum = `h1:${'A'.repeat(43)}=`; },
    f => { f.modules[0].GoModSum = `h1:${'A'.repeat(43)}=`; },
    f => { f.modules[0].Replace = { Path: '/tmp/unreviewed' }; },
    f => { f.modules[0].Error = 'missing retained module'; },
    f => { f.goMod += '\nreplace example.org/dep => /tmp/dep\n'; },
    f => { f.modules.push(structuredClone(f.modules[0])); },
  ]) {
    const f = { goMod, goSum: sums, modules: [structuredClone(module)] }; mutate(f);
    assert.throws(() => verifyResolvedModules(f), /scanner-contract/);
  }
});

test('should reversibly encode retained proxy paths within the contract charset', () => {
  for (const proxyPath of [
    'github.com/go-jose/go-jose/v4/@v/v4.1.6.zip',
    'github.com/!ada!logics/go-fuzz-headers/@v/v0.0.0-20240806141605-e8a1dd7889d6.mod',
    'github.com/coreos/go-oidc/@v/v2.5.0+incompatible.info',
    'gopkg.in/yaml.v3/@v/v3.0.1.mod',
  ]) {
    const retained = retainedProxyPath(proxyPath);
    assert.match(retained, /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
    assert.equal(proxyPathFromRetained(retained), proxyPath);
  }
  assert.throws(() => retainedProxyPath('github.com/a b/@v/v1.0.0.zip'), /scanner-contract/);
  assert.throws(() => proxyPathFromRetained('github.com/x/@v/v1.0.0.zip'), /scanner-contract/);
  assert.throws(() => proxyPathFromRetained('../escape'), /scanner-contract/);
});

test('should use only a retained file proxy with fresh caches and no inherited credentials or toolchain fetch', () => {
  const env = offlineGoEnvironment('/tmp/replay', '/materials/proxy', '/tmp/compiler');
  assert.equal(env.GOPROXY, 'file:///materials/proxy');
  assert.equal(env.GOTOOLCHAIN, 'local');
  assert.equal(env.GOENV, 'off');
  assert.equal(env.GOWORK, 'off');
  assert.equal(env.GOTELEMETRY, 'off');
  assert.equal(env.GOSUMDB, 'off');
  assert.equal(env.GOFLAGS, '-mod=readonly');
  assert.equal(env.GOVCS, '*:off');
  assert.equal(env.GOMODCACHE, '/tmp/replay/modcache');
  assert.equal(env.HOME, '/tmp/replay/home');
  assert.equal(Object.keys(env).some(key => /TOKEN|KEY|PASSWORD|SECRET/.test(key)), false);
});
