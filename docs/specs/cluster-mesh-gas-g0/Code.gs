// G0 spike probe (spec/SPEC_EVOL_CLUSTER_MESH_GAS.md r3, lot G0). Run once in the Airbus tenant
// (V8 runtime, USER_ACCESSING). Entry point: runG0(). Output: one JSON line via console.log.
// Report only: no dossier data, no secrets, no external fetch.
function runG0() {
  var r = {};
  function t(k, f) { try { r[k] = f(); } catch (e) { r[k] = 'ERR:' + String(e).slice(0, 160); } }
  function hex(b) { return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join(''); }
  // Q1 digest overloads (expected sha256('abc') = ba7816bf...15ad; sha256('é') utf-8 = 8f0f5b0f...)
  t('digest_string_abc', function () { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc')); });
  t('digest_string_utf8', function () { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'é中😀')); });
  t('digest_bytes_signed', function () { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, [97, 98, 99, -1, 128 - 256])); });
  // Q2 language/runtime globals
  t('runtime_version', function () { return typeof Session !== 'undefined' ? ScriptApp.getService ? 'svc' : 'n/a' : 'n/a'; });
  t('has_Promise', function () { return typeof Promise; });
  t('async_fn', function () { return (function () { try { return typeof eval('(async function(){})'); } catch (e) { return 'ERR:' + e; } })(); });
  t('has_TextEncoder', function () { return typeof TextEncoder; });
  t('has_crypto', function () { return typeof crypto; });
  t('has_crypto_subtle', function () { return typeof crypto !== 'undefined' ? typeof crypto.subtle : 'undefined'; });
  t('has_URL', function () { return typeof URL; });
  t('has_structuredClone', function () { return typeof structuredClone; });
  t('has_globalThis', function () { return typeof globalThis; });
  t('es2019_probe', function () { return [1, [2]].flat().length + ':' + Object.fromEntries([['a', 1]]).a + ':' + typeof Symbol.asyncIterator; });
  t('es2020_probe', function () { return eval('(null ?? 1) + (({a:{b:2}}).a?.b)'); });
  // Q3 Properties limits (script properties, throwaway keys g0:*, cleaned up)
  t('props_value_limit_bytes', function () {
    var p = PropertiesService.getScriptProperties(), ok = 0;
    [1024, 4096, 9000, 9500, 12000, 65536].forEach(function (n) { try { p.setProperty('g0:v', new Array(n + 1).join('x')); ok = n; } catch (e) {} });
    p.deleteProperty('g0:v'); return ok;
  });
  t('props_key_count', function () {
    var p = PropertiesService.getScriptProperties(), n = 0, o = {};
    try { for (; n < 600; n++) { o['g0:k' + n] = '{"fileId":"x","sha256":"' + new Array(65).join('a') + '","bytes":1,"createdAt":"2026-11-07"}'; } p.setProperties(o); } catch (e) { r.props_key_error = String(e).slice(0, 120); }
    var keys = Object.keys(p.getProperties()).filter(function (k) { return k.indexOf('g0:k') === 0; });
    keys.forEach(function (k) { p.deleteProperty(k); }); return keys.length;
  });
  // Q4 LockService
  t('lock_script', function () { var l = LockService.getScriptLock(); var ok = l.tryLock(2000); if (ok) l.releaseLock(); return ok; });
  // Q5 identity under USER_ACCESSING
  t('active_user_domain_only', function () { var e = Session.getActiveUser().getEmail(); return e ? e.split('@').slice(1).join('@') : ''; });
  // Q6 manifest facts
  t('oauth_scopes', function () { return ScriptApp.getOAuthToken ? 'getOAuthToken-present' : 'n/a'; });
  console.log(JSON.stringify(r));
  return r;
}
