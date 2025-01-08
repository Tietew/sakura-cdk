import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  prettier,
  {
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
    },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      'comma-dangle': ['error', 'always-multiline'],
      semi: ['error', 'always'],
      'import/no-absolute-path': 'error',
      'import/no-duplicates': ['warn', { 'prefer-inline': true }],
      'import/no-dynamic-require': 'error',
      'import/no-relative-packages': 'error',
      'import/no-useless-path-segments': 'error',
      'import/order': ['error', { alphabetize: { order: 'asc' } }],
      'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: ['jest.config.js', 'cdk.out/**/*', 'lib/cloudfront/*.js'],
  },
);
