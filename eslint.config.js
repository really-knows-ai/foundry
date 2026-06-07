// ESLint flat config — super-strict for ESM Node.js project
import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import eslintComments from 'eslint-plugin-eslint-comments';

export default [
  // Base: ALL core ESLint rules enabled
  js.configs.all,

  // Ban all eslint-disable comments
  {
    plugins: { 'eslint-comments': eslintComments },
    rules: {
      'eslint-comments/no-use': 'error',
      'eslint-comments/no-unused-disable': 'error',
      'eslint-comments/no-unused-enable': 'error',
      'eslint-comments/no-unlimited-disable': 'error',
      'eslint-comments/no-duplicate-disable': 'error',
    },
  },


  // SonarJS recommended rules (bug detection + code smell)
  sonarjs.configs.recommended,

  // Project-specific language options and rule overrides
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },

    rules: {
      // -- Project-specific relaxations (CLI tool / test patterns) --

      'no-console': 'off',                    // CLI tools use console
      'no-process-exit': 'off',               // CLI tools exit with codes
      'no-empty': ['error', { allowEmptyCatch: true }],

      // -- Stylistic: relax opinionated formatting rules --
      // (When using Prettier alongside, many of these should be off)
      'max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
      'capitalized-comments': 'off',
      'line-comment-position': 'off',
      'no-inline-comments': 'off',
      'multiline-comment-style': 'off',
      'no-warning-comments': 'off',
      'spaced-comment': ['error', 'always', { markers: ['/'] }],
      'curly': 'off',                         // project uses braceless single-line if statements

      // -- Relax overly restrictive style rules --
      'camelcase': 'off',
      'func-style': 'off',
      'func-names': 'off',
      'logical-assignment-operators': 'off',
      'one-var': 'off',
      'no-ternary': 'off',
      'no-nested-ternary': 'error',
      'no-plusplus': 'off',
      'no-continue': 'off',
      'no-labels': ['error', { allowLoop: true }],
      'no-underscore-dangle': 'off',
      'no-void': 'off',
      'no-undefined': 'off',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'no-param-reassign': ['error', { props: false }],
      'consistent-return': 'off',
      'default-case': 'off',
      'default-case-last': 'error',
      'no-else-return': ['error', { allowElseIf: false }],

      // -- Relax variable / naming rules --
      'id-length': 'off',
      'id-denylist': 'off',
      'init-declarations': 'off',
      'sort-imports': 'off',
      'sort-keys': 'off',
      'sort-vars': 'off',
      'no-unused-vars': 'off', // prefer sonarjs/no-unused-vars
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],

      // -- Relax complexity limits (warn not error) --
      'complexity': ['error', 5],
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 5],
      'max-statements': ['error', 30],
      'max-classes-per-file': 'off',

      // -- Relax style preferences --
      'prefer-destructuring': 'off',
      'prefer-template': 'off',
      'prefer-arrow-callback': 'off',
      'prefer-object-spread': 'off',
      'prefer-spread': 'off',
      'prefer-rest-params': 'off',
      'prefer-exponentiation-operator': 'off',
      'prefer-named-capture-group': 'off',
      'prefer-numeric-literals': 'off',
      'require-unicode-regexp': 'off',
      'prefer-regex-literals': 'off',
      'object-shorthand': 'off',
      'arrow-body-style': 'off',
      'no-array-constructor': 'off',
      'no-new-object': 'off',
      'no-new-wrappers': 'error',

      // -- Other relaxations --
      'no-await-in-loop': 'off',
      'require-await': 'off',               // async plugin interfaces don't always use await
      'no-restricted-syntax': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-exports': 'off',
      'require-atomic-updates': 'off',        // false positives for locally-scoped async mutations
      'no-return-await': 'off',
      'no-magic-numbers': 'off',
      'no-invalid-this': 'off',
      'no-extra-bind': 'off',
      'no-implicit-coercion': 'off',
      'no-lonely-if': 'off',
      'no-negated-condition': 'off',
      'no-prototype-builtins': 'error',
      'no-sequences': ['error', { allowInParentheses: true }],
      'no-confusing-arrow': 'off',
      'no-mixed-operators': 'off',
      'yoda': 'off',
      'radix': 'off',
      'guard-for-in': 'error',
      'operator-assignment': 'off',
      'prefer-numeric-literals': 'error',
      'new-cap': 'off',
      'no-new': 'off',
      'no-alert': 'off',
      'strict': 'off',
      'wrap-iife': 'off',
      'quote-props': 'off',
      'quotes': 'off',
      'semi': 'off',
      'comma-dangle': 'off',
      'indent': 'off',
      'no-tabs': 'off',
      'no-trailing-spaces': 'off',
      'eol-last': 'off',
      'no-multiple-empty-lines': 'off',
      'padding-line-between-statements': 'off',
      'dot-location': 'off',
      'array-element-newline': 'off',
      'array-bracket-newline': 'off',
      'array-bracket-spacing': 'off',
      'arrow-parens': 'off',
      'arrow-spacing': 'off',
      'block-spacing': 'off',
      'brace-style': 'off',
      'comma-spacing': 'off',
      'comma-style': 'off',
      'computed-property-spacing': 'off',
      'function-call-argument-newline': 'off',
      'function-paren-newline': 'off',
      'generator-star-spacing': 'off',
      'implicit-arrow-linebreak': 'off',
      'key-spacing': 'off',
      'keyword-spacing': 'off',
      'lines-around-comment': 'off',
      'lines-between-class-members': 'off',
      'max-statements-per-line': 'off',
      'multiline-ternary': 'off',
      'new-parens': 'off',
      'newline-per-chained-call': 'off',
      'no-extra-parens': 'off',
      'no-whitespace-before-property': 'off',
      'nonblock-statement-body-position': 'off',
      'object-curly-newline': 'off',
      'object-curly-spacing': 'off',
      'object-property-newline': 'off',
      'operator-linebreak': 'off',
      'padded-blocks': 'off',
      'rest-spread-spacing': 'off',
      'semi-spacing': 'off',
      'semi-style': 'off',
      'space-before-blocks': 'off',
      'space-before-function-paren': 'off',
      'space-in-parens': 'off',
      'space-infix-ops': 'off',
      'space-unary-ops': 'off',
      'switch-colon-spacing': 'off',
      'template-curly-spacing': 'off',
      'template-tag-spacing': 'off',
      'unicode-bom': 'off',
      'wrap-regex': 'off',
      'yield-star-spacing': 'off',

      // -- SonarJS overrides (if needed) --
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',       // too noisy for tests/config
      'sonarjs/max-switch-cases': 'off',
      'sonarjs/prefer-single-boolean-return': 'off',
      'sonarjs/no-small-switch': 'off',
    },
  },

  // Test files: relax rules that don't make sense in test contexts
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    rules: {
      'complexity': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      'no-sparse-arrays': 'off',
      'no-control-regex': 'off',
      'max-params': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/os-command': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'sonarjs/slow-regex': 'off',             // test regexes match fixed git output, not user input
      'no-template-curly-in-string': 'off',     // test fixtures contain bash/template-like syntax
      'no-empty-function': 'off',
      'no-loop-func': 'off',
      'require-atomic-updates': 'off',        // false positives for save/restore globals in finally blocks
    },
  },

  // Plugin validation tool: requires OS command execution
  {
    files: ['src/plugin/tools/validate-tools.js'],
    rules: {
      'sonarjs/os-command': 'off',
    },
  },

  // Shared validation module: requires OS command execution
  {
    files: ['src/scripts/lib/validation.js'],
    rules: {
      'sonarjs/os-command': 'off',
    },
  },

  // Attestation verify: requires OS command execution via PATH
  {
    files: ['src/scripts/lib/attestation/verify.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Attestation tools: requires OS command execution via PATH
  {
    files: ['src/plugin/tools/attestation-tools.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Shared tool helpers: makeExecGit runs git via PATH
  {
    files: ['src/plugin/tools/helpers.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Config create tools: requires OS command execution via PATH
  {
    files: ['src/plugin/tools/config-create-tools.js', 'src/plugin/tools/config-law-tools.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Orchestrate tool: requires OS command execution via PATH
  {
    files: ['src/plugin/tools/orchestrate-tool.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Git tools: requires OS command execution via PATH
  {
    files: ['src/plugin/tools/git-tools.js', 'src/plugin/tools/git-helpers.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Stage tools: requires OS command execution via PATH
  {
    files: ['src/plugin/tools/stage-tools.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Build and release scripts: requires OS command execution via PATH
  {
    files: ['scripts/seal.js', 'scripts/verify-seal.js', 'scripts/build.js'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Ignore build output and dependencies
  {
    ignores: ['dist/', 'node_modules/', '.foundry/', '.snapshots/', '.worktrees/'],
  },
];
