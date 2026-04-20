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
          "MemberExpression[property.name='electronAPI'][object.type='MemberExpression'][object.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='MemberExpression'][object.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='MemberExpression'][object.computed=true][object.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='MemberExpression'][object.computed=true][object.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='MemberExpression'][object.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='MemberExpression'][object.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='MemberExpression'][object.computed=true][object.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='MemberExpression'][object.computed=true][object.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 호출하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSAsExpression'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSAsExpression'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.type='MemberExpression'][object.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.type='MemberExpression'][object.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSAsExpression'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSNonNullExpression'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSNonNullExpression'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.type='MemberExpression'][object.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.type='MemberExpression'][object.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSNonNullExpression'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSTypeAssertion'][object.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[computed=true][property.value='electronAPI'][object.type='TSTypeAssertion'][object.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.type='MemberExpression'][object.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.type='MemberExpression'][object.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "MemberExpression[property.name='electronAPI'][object.type='TSTypeAssertion'][object.expression.type='MemberExpression'][object.expression.computed=true][object.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          ":matches(MemberExpression[property.name='electronAPI'], MemberExpression[computed=true][property.value='electronAPI']):has(:matches(TSAsExpression, TSNonNullExpression, TSTypeAssertion) :matches(Identifier[name='window'], Identifier[name='globalThis'], Literal[value='window'], Literal[value='globalThis']))",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis 기반 electronAPI 직접 접근을 우회하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 window/globalThis를 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.name='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 window/globalThis를 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSAsExpression'][init.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSAsExpression'][init.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSAsExpression'][init.expression.type='MemberExpression'][init.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSAsExpression'][init.expression.type='MemberExpression'][init.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSAsExpression'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSAsExpression'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='MemberExpression'][init.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='MemberExpression'][init.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='MemberExpression'][init.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='MemberExpression'][init.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='MemberExpression'][init.expression.computed=true][init.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.property.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.property.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.computed=true][init.expression.expression.property.value='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSNonNullExpression'][init.expression.type='TSAsExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.computed=true][init.expression.expression.property.value='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.property.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.property.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.computed=true][init.expression.expression.property.value='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='TSTypeAssertion'][init.expression.type='TSNonNullExpression'][init.expression.expression.type='MemberExpression'][init.expression.expression.computed=true][init.expression.expression.property.value='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 변수나 구조분해 대상으로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
        selector: "VariableDeclarator[init.type='MemberExpression'][init.property.name='window'][id.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.property.name='globalThis'][id.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='window'][id.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "VariableDeclarator[init.type='MemberExpression'][init.computed=true][init.property.value='globalThis'][id.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
      {
        selector: "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'][left.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'][left.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'][left.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'][left.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[key.name='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 window.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 globalThis.electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='electronAPI']",
        message:
          'renderer에서는 전역 객체 체인을 통해 electronAPI를 직접 구조분해하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSAsExpression'][right.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSAsExpression'][right.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSAsExpression'][right.expression.type='MemberExpression'][right.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSAsExpression'][right.expression.type='MemberExpression'][right.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSAsExpression'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSAsExpression'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='MemberExpression'][right.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='MemberExpression'][right.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 non-null 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.name='window']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.name='globalThis']",
        message:
          'renderer에서는 window/globalThis에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='MemberExpression'][right.expression.property.name='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='MemberExpression'][right.expression.property.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='window']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='MemberExpression'][right.expression.computed=true][right.expression.property.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인에 타입 단언을 적용해 direct bridge 우회를 시도하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.property.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.property.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.computed=true][right.expression.expression.property.value='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSNonNullExpression'][right.expression.type='TSAsExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.computed=true][right.expression.expression.property.value='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 window/globalThis를 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.property.name='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.property.name='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.computed=true][right.expression.expression.property.value='window']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='TSTypeAssertion'][right.expression.type='TSNonNullExpression'][right.expression.expression.type='MemberExpression'][right.expression.expression.computed=true][right.expression.expression.property.value='globalThis']",
        message:
          'renderer에서는 중첩된 TS wrapper로 전역 객체 체인을 대입식에 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 window/globalThis를 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 window/globalThis를 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > RestElement[argument.type='Identifier']",
        message:
          'renderer에서는 전역 객체 체인을 rest 구조분해로 별칭 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector: "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[key.name='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[key.name='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 window/globalThis를 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.property.name='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='window'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='window']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
      },
      {
        selector:
          "AssignmentExpression[right.type='MemberExpression'][right.computed=true][right.property.value='globalThis'] > ObjectPattern > Property[computed=true][key.value='globalThis']",
        message:
          'renderer에서는 전역 객체 체인을 구조분해해 별칭으로 저장하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.',
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
