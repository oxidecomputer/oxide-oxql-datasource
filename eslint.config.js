const grafanaConfig = require('@grafana/eslint-config/flat');

module.exports = [
  {
    ignores: ['dist/', 'node_modules/', '.config/', 'artifacts/', 'work/', 'ci/', 'coverage/'],
  },
  ...grafanaConfig,
  {
    rules: {
      'react/prop-types': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'warn',
    },
  },
  {
    files: ['tests/**/*'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];
