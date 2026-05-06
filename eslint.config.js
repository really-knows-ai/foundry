// ESLint flat config for ESM Node.js project
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Enforce British spelling in comments would require a plugin, skip for now
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // CLI tools use console
      'no-empty': ['error', { allowEmptyCatch: true }], // Allow empty catch blocks
      'no-sparse-arrays': 'off', // Allow sparse arrays in tests
      'no-control-regex': 'off', // Allow control chars in regex (for validation tests)
    },
  },
  {
    // Ignore build output and dependencies
    ignores: ['dist/', 'node_modules/', '.foundry/', '.snapshots/', '.worktrees/'],
  },
];
