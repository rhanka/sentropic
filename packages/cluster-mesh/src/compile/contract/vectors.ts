import type { CompileRecipeV1 } from './types.js';

/** Public cross-consumer corpus. Exact source bytes are <template>Hello</template>. */
export const COMPILE_CONFORMANCE_RECIPE: CompileRecipeV1 = {
  recipeVersion: 1,
  sources: [{ path: 'App.vue', bytesBase64: 'PHRlbXBsYXRlPkhlbGxvPC90ZW1wbGF0ZT4=' }],
  entry: 'App.vue', kind: 'vue-sfc', profile: 'browser-vapor',
  compilers: [{ role: 'sfc', name: '@vue/compiler-sfc', version: '3.6.0-rc.15', sha256: '1'.repeat(64) }],
  dsTuple: [{ name: 'vue', version: '3.6.0-rc.15', sha256: '2'.repeat(64) }],
  dependencyLockDigest: '3'.repeat(64), importMapManifestDigest: '4'.repeat(64), catalogDigest: '5'.repeat(64),
  options: { workspaceMap: {}, aliases: [], extensions: ['.ts', '.js', '.vue', '.json', '.css'],
    urlRewriteMode: 'import-map-external', sourcemap: false },
  policyVersion: 'compile-policy.v1', trustLane: 'isolate-untrusted', accessPartition: 'public-v1',
};
export const COMPILE_CONFORMANCE_VECTORS = {
  jcs: [
    { input: { z: 1, a: { '\u20ac': 2, '\r': 3 } }, expected: '{"a":{"\\r":3,"€":2},"z":1}' },
    { input: [-0, 1e30, 0.0000001, 0.000001], expected: '[0,1e+30,1e-7,0.000001]' },
    { input: { '\ufffd': 1, '\ud83d\ude00': 2, '\u20ac': 3 }, expected: '{"€":3,"😀":2,"�":1}' },
  ],
  sha256: [
    { text: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    { text: 'abc', expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  ],
  invalidPaths: ['', '/App.vue', '../App.vue', './App.vue', 'a//b', 'a/../b', 'C:/a', 'a\\b', 'https:a', 'a\0b'],
  invalidBase64: ['a', 'YQ', 'YQ=','YR==', 'YQ==\n', 'YQ__'],
  invalidJson: ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[1,]', '{"a":1,}', '1e999', '01', '\u00a0{}'],
} as const;
