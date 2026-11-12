module.exports = require('../../api/eslint.config.cjs').map(config => ({
  ...config,
  files: ['**/*.ts'],
  languageOptions: {
    ...config.languageOptions,
    parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: __dirname },
  },
}));
