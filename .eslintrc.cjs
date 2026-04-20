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
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import', 'boundaries'],
  settings: {
    react: {
      version: 'detect',
    },
    'import/core-modules': ['electron'],
    'boundaries/dependency-nodes': ['import', 'dynamic-import', 'require', 'export'],
    'boundaries/elements': [
      { type: 'electron', pattern: 'electron/**/*' },
      { type: 'renderer', pattern: 'src/renderer/**/*' },
      { type: 'cli', pattern: 'src/cli/**/*' },
      { type: 'core-downloaders', pattern: 'src/core/downloaders/**/*' },
      { type: 'core-resolver', pattern: 'src/core/resolver/**/*' },
      { type: 'core-ports', pattern: 'src/core/ports/**/*' },
      { type: 'core-shared', pattern: 'src/core/shared/**/*' },
      { type: 'core-packager', pattern: 'src/core/packager/**/*' },
      { type: 'core-mailer', pattern: 'src/core/mailer/**/*' },
      { type: 'core-root', pattern: 'src/core/*' },
      { type: 'core-constants', pattern: 'src/core/constants/**/*' },
      { type: 'types', pattern: 'src/types/**/*' },
      { type: 'utils', pattern: 'src/utils/**/*' },
      { type: 'tests', pattern: 'tests/**/*' },
    ],
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
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index', 'type'],
        'newlines-between': 'never',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-cycle': 'warn',
    'import/no-internal-modules': [
      'warn',
      {
        allow: [
          './**',
          '../**',
          '../../**',
          '../../../**',
          '../../../../**',
          '../../../../../**',
          'antd/**',
          'react-dom/**',
          'vite/**',
          'vitest/**',
        ],
      },
    ],
    'import/no-restricted-paths': [
      'warn',
      {
        basePath: __dirname,
        zones: [
          {
            target: './src/core/downloaders',
            from: './src/core/resolver',
            message: '다운로더는 resolver 구현이 아니라 core/ports를 통해 상호작용해야 합니다.',
          },
          {
            target: './src/core/resolver',
            from: './src/core/downloaders',
            message: 'resolver는 downloader 구현이 아니라 core/ports를 통해 상호작용해야 합니다.',
          },
        ],
      },
    ],
    'boundaries/dependencies': [
      'warn',
      {
        default: 'allow',
        rules: [
          { from: { type: 'renderer' }, disallow: { to: { type: 'electron' } } },
          { from: { type: 'electron' }, disallow: { to: { type: 'renderer' } } },
          { from: { type: 'cli' }, disallow: { to: { type: ['renderer', 'electron'] } } },
          {
            from: {
              type: [
                'core-root',
                'core-constants',
                'core-downloaders',
                'core-resolver',
                'core-ports',
                'core-shared',
                'core-packager',
                'core-mailer',
              ],
            },
            disallow: { to: { type: ['renderer', 'electron', 'cli'] } },
          },
        ],
      },
    ],
    'no-restricted-syntax': [
      'warn',
      {
        selector: "MemberExpression[object.name='window'][property.name='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "MemberExpression[object.name='globalThis'][property.name='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[object.name='window'][computed=true][property.value='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[object.name='globalThis'][computed=true][property.value='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='window'][id.type='Identifier']",
        message:
          'renderer에서는 window를 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='globalThis'][id.type='Identifier']",
        message:
          'renderer에서는 globalThis를 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='window'][left.type='Identifier']",
        message:
          'renderer에서는 window를 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='globalThis'][left.type='Identifier']",
        message:
          'renderer에서는 globalThis를 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
        'no-restricted-syntax': 'off',
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
    {
      files: ['src/renderer/lib/renderer-data-client.ts'],
      rules: {
        'no-restricted-syntax': 'off',
      },
    },
  ],
};
