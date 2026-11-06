import svelte from 'eslint-plugin-svelte';
import ts from '@typescript-eslint/parser';
export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  ...svelte.configs['flat/recommended'],
  { files: ['**/*.ts'], languageOptions: { parser: ts } },
  { files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: ts } } },
];
