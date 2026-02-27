import js from '@eslint/js';

export default [
  {
    ignores: ['build/**', 'chrome-ext/dist/**', 'node_modules/**', '**/*.d.ts', '.vite/**', '.svelte-kit/**']
  },
  {
    languageOptions: {
      globals: {
        console: 'readonly'
      }
    }
  },
  js.configs.recommended
];
