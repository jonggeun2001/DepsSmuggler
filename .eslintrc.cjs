/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  ignorePatterns: ['dist/', 'build/', 'coverage/', 'node_modules/', '*.min.js'],
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // React
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',

    // React Hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // Import
    'import/order': [
      'warn',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          ['parent', 'sibling'],
          'index',
          'type',
        ],
        'newlines-between': 'never',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-restricted-paths': [
      'error',
      {
        basePath: __dirname,
        zones: [
          {
            target: './src/core/downloaders',
            from: './src/core/resolver',
            message: 'core/ports 또는 src/core/shared 경계를 사용하세요.',
          },
          {
            target: './src/core/resolver',
            from: './src/core/downloaders',
            message: 'core/ports 또는 src/core/shared 경계를 사용하세요.',
          },
        ],
      },
    ],

    // General
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'warn',
    'no-var': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  overrides: [
    {
      // Test files
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    {
      // CLI 출력은 사용자 인터페이스의 일부
      files: ['src/cli/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      // Electron main process
      files: ['electron/**/*.ts'],
      env: {
        node: true,
        browser: false,
      },
    },
  ],
};
