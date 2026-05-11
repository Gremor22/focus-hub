import js from '@eslint/js';
import globals from 'globals';

const browserGlobals = {
  ...globals.browser,
  ...globals.serviceworker,
  firebase: 'readonly',
  importScripts: 'readonly'
};

const workerGlobals = {
  ...browserGlobals,
  caches: 'readonly',
  clients: 'readonly'
};

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.wrangler/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: browserGlobals
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['sw.js', 'firebase-messaging-sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: workerGlobals
    }
  },
  {
    files: ['_worker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: workerGlobals
    }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024
      }
    }
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
        ...globals.vitest
      }
    }
  }
];
