// G0 runtime probe (spec/SPEC_EVOL_CLUSTER_MESH_GAS.md r3, lot G0). Paste into an Apps Script V8 project of the
// target tenant and run `runG0()` ONCE. It prints one JSON verdict via console.log (Cloud Logging / Executions)
// and returns it. Report only: no dossier data, no secrets, no external fetch. Throwaway keys `g0:*` are cleaned up.
// Each check maps to a CONSERVATIVE ASSUMPTION encoded in the bundle (src/gas/probe.ts); see ASSUMPTIONS.md.
// Verdict: PASS = every REQUIRED check passed; FAIL = at least one REQUIRED check failed; INFO checks never fail.
var G0_PROBE_VERSION = 1;
var G0_KEY_BUDGET = 100;       // assumed usable script-property keys for the store (mode a)
var G0_CHUNK_BYTES = 8192;     // assumed safe value size (< 9 KB documented cap)

function runG0() {
  var checks = [];
  function check(id, required, fn) {
    var out = { id: id, required: required, ok: false, detail: '' };
    try { var r = fn(); out.ok = r === true || (r && r.ok === true); out.detail = r && r.detail !== undefined ? String(r.detail).slice(0, 200) : ''; }
    catch (e) { out.ok = false; out.detail = 'threw: ' + String(e).slice(0, 160); }
    checks.push(out);
  }
  function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
  function signed(arr) { return arr.map(function (b) { return (b << 24) >> 24; }); }
  function digest(arr) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed(arr))); }

  // R1 sha256 over BYTES only (string overload is never relied on).
  check('digest_bytes_abc', true, function () { var h = digest([0x61, 0x62, 0x63]); return { ok: h === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', detail: h }; });
  check('digest_bytes_high_bit', true, function () { var h = digest([0xc3, 0xa9]); return { ok: h === '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c', detail: h }; });
  check('digest_bytes_4byte_utf8', true, function () { var h = digest([0xf0, 0x9f, 0x98, 0x80]); return { ok: h === 'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9', detail: h }; });
  check('digest_bytes_empty', true, function () { var h = digest([]); return { ok: h === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', detail: h }; });
  // R2 bundle syntax level (bundle is emitted at es2019; these are the constructs the output may contain).
  check('syntax_es2019', true, function () {
    var o = { a: 1 }; var s = Object.assign({}, o, { b: 2 }); var f = [1, [2]].flat();
    try { void 0; } catch (_) {}
    return { ok: s.b === 2 && f.length === 2 && typeof Object.fromEntries === 'function' };
  });
  // R3 LockService (publish path, mode a).
  check('lock_script', true, function () { var l = LockService.getScriptLock(); var ok = l.tryLock(2000); if (ok) l.releaseLock(); return { ok: ok }; });
  // R4 Properties: chunk size and key budget.
  check('props_chunk_8192', true, function () {
    var p = PropertiesService.getScriptProperties(); var v = new Array(G0_CHUNK_BYTES + 1).join('x');
    try { p.setProperty('g0:chunk', v); return { ok: p.getProperty('g0:chunk') === v }; } finally { p.deleteProperty('g0:chunk'); }
  });
  check('props_key_budget', true, function () {
    var p = PropertiesService.getScriptProperties(), o = {}, i, n = 0;
    for (i = 0; i < G0_KEY_BUDGET; i++) o['g0:k' + i] = 'v' + i;
    try { p.setProperties(o); n = Object.keys(p.getProperties()).filter(function (k) { return k.indexOf('g0:k') === 0; }).length; return { ok: n === G0_KEY_BUDGET, detail: n }; }
    finally { Object.keys(o).forEach(function (k) { p.deleteProperty(k); }); }
  });
  // R5 identity under USER_ACCESSING (domain part only is reported).
  check('active_user_email', true, function () { var e = Session.getActiveUser().getEmail(); var n = e ? e.split('@').length : 0; return { ok: n === 2, detail: n === 2 ? e.split('@')[1] : 'no/odd email' }; });
  // INFO: facts the bundle must NOT depend on (recorded so the assumption can be relaxed later).
  var info = {
    Promise: typeof Promise, async_fn: (function () { try { return typeof eval('(async function(){})'); } catch (e) { return 'ERR'; } })(),
    TextEncoder: typeof TextEncoder, crypto: typeof crypto, URL: typeof URL, globalThis: typeof globalThis,
    digest_string_abc: (function () { try { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc')); } catch (e) { return 'ERR'; } })(),
    props_value_limit_probe: (function () {
      var p = PropertiesService.getScriptProperties(), ok = 0;
      [9000, 9500, 12000, 65536].forEach(function (n) { try { p.setProperty('g0:v', new Array(n + 1).join('x')); ok = n; } catch (e) {} });
      p.deleteProperty('g0:v'); return ok;
    })()
  };
  var failed = checks.filter(function (c) { return c.required && !c.ok; }).map(function (c) { return c.id; });
  var verdict = { probe: 'g0', version: G0_PROBE_VERSION, verdict: failed.length === 0 ? 'PASS' : 'FAIL', failed: failed, checks: checks, info: info };
  console.log(JSON.stringify(verdict));
  return verdict;
}
