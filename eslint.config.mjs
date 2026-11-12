// ESLint flat config.
//
// Next 16 removed `next lint`, so there is no built-in ESLint wiring any more.
// This file is the replacement. eslint-config-next 16 exports native flat
// configs, so no FlatCompat shim is needed (FlatCompat throws on this version).
//
// Run: npm run lint

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'server/node_modules/**',
      'server/dist/**',
      'dist/**',
      'next-env.d.ts',
      'data/**',
      'tools/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // AGENTS.md §8: no `any` left behind.
      '@typescript-eslint/no-explicit-any': 'error',

      // AGENTS.md §8: no unfinished-work markers left behind. Warn now,
      // tighten to an error in Phase 12.
      'no-warning-comments': [
        'warn',
        { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' },
      ],

      // Unused vars are an error, but a leading underscore opts out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // A stray console.log in a client component ships to production.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /**
   * The API server.
   *
   * It was excluded from lint entirely until Phase 6, which meant the Phase 6
   * gate's `npm run lint` said nothing about the code Phase 6 added. It gets
   * its own block: Node globals, no React rules, and the same no-`any` and
   * no-unused-vars bar as the storefront.
   */
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-warning-comments': [
        'warn',
        { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' },
      ],
      // The server logs through pino; a raw console is a bug there too.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Node ESM: `import x from 'node:fs'` is fine, `require` is not.
      'no-undef': 'off',
    },
  },

  /**
   * Evidence scripts print to stdout on purpose — that is their whole job.
   * They are run by hand, never imported by the app. The seed is a CLI too.
   */
  {
    files: ['server/tests/_*.ts', 'server/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
