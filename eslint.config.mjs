// ESLint flat config.
//
// Next 16 removed `next lint`, so there is no built-in ESLint wiring any more.
// This file is the replacement. eslint-config-next 16 exports native flat
// configs, so no FlatCompat shim is needed (FlatCompat throws on this version).
//
// Run: npm run lint

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'server/**',
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
];

export default config;
