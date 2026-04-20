import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import parser from '@typescript-eslint/parser';

const WRAPPER_TYPES = new Set([
  'ChainExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);
const GUARDED_KEYS = new Set(['window', 'globalThis']);
const ELECTRON_API_KEY = 'electronAPI';
const TARGET_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(repoRoot, 'src/renderer');
const baselinePath = path.join(
  repoRoot,
  'config/guardrails/renderer-bridge-guardrails-baseline.json'
);
const updateBaseline = process.argv.includes('--update');

const RULE_ID = 'renderer-bridge-guardrail';
const DIRECT_ACCESS_MESSAGE =
  'renderer에서는 window/globalThis 기반 electronAPI 직접 접근을 새로 추가하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.';
const GLOBAL_ALIAS_MESSAGE =
  'renderer에서는 window/globalThis 또는 전역 객체 체인을 별칭/구조분해로 새로 끌어오지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.';
const ELECTRON_API_ALIAS_MESSAGE =
  'renderer에서는 electronAPI를 변수/구조분해로 새로 별칭화하지 말고 preload 계약 또는 renderer-data-client 게이트웨이를 사용하세요.';

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.constValues = new Map();
    this.valueKinds = new Map();
  }

  lookupConstValue(name) {
    if (this.constValues.has(name)) {
      return this.constValues.get(name);
    }
    return this.parent?.lookupConstValue(name) ?? null;
  }

  setConstValue(name, value) {
    this.constValues.set(name, value);
  }

  lookupValueKind(name) {
    if (this.valueKinds.has(name)) {
      return this.valueKinds.get(name);
    }
    return this.parent?.lookupValueKind(name) ?? null;
  }

  setValueKind(name, kind) {
    this.valueKinds.set(name, kind);
  }
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function createSignature(entry) {
  return JSON.stringify({
    filePath: entry.filePath,
    ruleId: entry.ruleId,
    message: entry.message,
    line: entry.line,
    column: entry.column,
    endLine: entry.endLine,
    endColumn: entry.endColumn,
  });
}

function summarize(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.ruleId] = (summary[entry.ruleId] ?? 0) + entry.count;
    return summary;
  }, {});
}

function isNode(value) {
  return Boolean(value && typeof value === 'object' && typeof value.type === 'string');
}

function unwrapExpression(node) {
  let current = node;
  while (isNode(current) && WRAPPER_TYPES.has(current.type)) {
    current = current.expression;
  }
  return current;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveConstValue(node, scope) {
  const current = unwrapExpression(node);
  if (!isNode(current)) {
    return null;
  }

  if (current.type === 'Literal' && typeof current.value === 'string') {
    return current.value;
  }

  if (
    current.type === 'TemplateLiteral' &&
    current.expressions.length === 0 &&
    current.quasis.length === 1
  ) {
    return current.quasis[0].value.cooked ?? current.quasis[0].value.raw ?? null;
  }

  if (current.type === 'Identifier') {
    return scope.lookupConstValue(current.name);
  }

  if (current.type === 'ObjectExpression') {
    const resolvedObject = {};
    for (const property of current.properties) {
      if (!isNode(property) || property.type !== 'Property') {
        return null;
      }

      const key = resolvePropertyKey(property.key, property.computed, scope);
      if (!key) {
        return null;
      }

      const value = resolveConstValue(property.value, scope);
      if (value === null) {
        return null;
      }

      resolvedObject[key] = value;
    }
    return resolvedObject;
  }

  if (current.type === 'MemberExpression') {
    const objectValue = resolveConstValue(current.object, scope);
    if (!isPlainObject(objectValue)) {
      return null;
    }

    const key = resolvePropertyKey(current.property, current.computed, scope);
    if (!key || !(key in objectValue)) {
      return null;
    }

    return objectValue[key];
  }

  return null;
}

function resolveStringLiteral(node, scope) {
  const value = resolveConstValue(node, scope);
  return typeof value === 'string' ? value : null;
}

function resolvePropertyKey(property, computed, scope) {
  if (!isNode(property)) {
    return null;
  }

  if (!computed && property.type === 'Identifier') {
    return property.name;
  }

  return resolveStringLiteral(property, scope);
}

function resolveValueKind(node, scope) {
  const current = unwrapExpression(node);
  if (!isNode(current)) {
    return null;
  }

  if (current.type === 'Identifier') {
    if (GUARDED_KEYS.has(current.name)) {
      return 'guard-global';
    }
    return scope.lookupValueKind(current.name);
  }

  if (current.type === 'LogicalExpression') {
    const leftKind = resolveValueKind(current.left, scope);
    const rightKind = resolveValueKind(current.right, scope);
    if (leftKind === 'guard-global' || rightKind === 'guard-global') {
      return 'guard-global';
    }
    if (leftKind === 'electron-api' || rightKind === 'electron-api') {
      return 'electron-api';
    }
    return null;
  }

  if (current.type === 'ConditionalExpression') {
    const consequentKind = resolveValueKind(current.consequent, scope);
    const alternateKind = resolveValueKind(current.alternate, scope);
    if (consequentKind === 'guard-global' || alternateKind === 'guard-global') {
      return 'guard-global';
    }
    if (consequentKind === 'electron-api' || alternateKind === 'electron-api') {
      return 'electron-api';
    }
    return null;
  }

  if (current.type === 'SequenceExpression') {
    const kinds = current.expressions.map((expression) => resolveValueKind(expression, scope));
    if (kinds.includes('guard-global')) {
      return 'guard-global';
    }
    if (kinds.includes('electron-api')) {
      return 'electron-api';
    }
    return null;
  }

  if (current.type !== 'MemberExpression') {
    return null;
  }

  const objectKind = resolveValueKind(current.object, scope);
  if (!objectKind) {
    return null;
  }

  const key = resolvePropertyKey(current.property, current.computed, scope);
  if (!key) {
    return null;
  }

  if (objectKind === 'guard-global') {
    if (key === ELECTRON_API_KEY) {
      return 'electron-api';
    }
    if (GUARDED_KEYS.has(key)) {
      return 'guard-global';
    }
    return null;
  }

  if (objectKind === 'electron-api') {
    return 'electron-api';
  }

  return null;
}

function getChildNodes(node) {
  const children = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item);
        }
      }
      continue;
    }
    if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function recordViolation(violationsMap, filePath, node, message) {
  if (!node?.loc) {
    return;
  }

  const entry = {
    filePath,
    ruleId: RULE_ID,
    message,
    line: node.loc.start.line,
    column: node.loc.start.column + 1,
    endLine: node.loc.end.line,
    endColumn: node.loc.end.column + 1,
    count: 1,
  };
  const signature = createSignature(entry);
  const existing = violationsMap.get(signature);
  if (existing) {
    existing.count += 1;
  } else {
    violationsMap.set(signature, entry);
  }
}

function recordPattern(pattern, sourceKind, scope, filePath, violationsMap) {
  if (!isNode(pattern)) {
    return;
  }

  if (pattern.type === 'Identifier') {
    scope.setValueKind(pattern.name, sourceKind);
    return;
  }

  if (pattern.type === 'AssignmentPattern') {
    recordPattern(pattern.left, sourceKind, scope, filePath, violationsMap);
    return;
  }

  if (pattern.type !== 'ObjectPattern') {
    return;
  }

  for (const property of pattern.properties) {
    if (!isNode(property)) {
      continue;
    }

    if (property.type === 'RestElement') {
      recordViolation(violationsMap, filePath, property, GLOBAL_ALIAS_MESSAGE);
      recordPattern(property.argument, sourceKind, scope, filePath, violationsMap);
      continue;
    }

    if (property.type !== 'Property') {
      continue;
    }

    const key = resolvePropertyKey(property.key, property.computed, scope);
    if (sourceKind === 'guard-global') {
      if (key === ELECTRON_API_KEY) {
        recordViolation(violationsMap, filePath, property, ELECTRON_API_ALIAS_MESSAGE);
        recordPattern(property.value, 'electron-api', scope, filePath, violationsMap);
        continue;
      }
      if (key && GUARDED_KEYS.has(key)) {
        recordViolation(violationsMap, filePath, property, GLOBAL_ALIAS_MESSAGE);
        recordPattern(property.value, 'guard-global', scope, filePath, violationsMap);
      }
    }
  }
}

function handleVariableDeclarator(node, scope, filePath, violationsMap, declarationKind) {
  if (node.init) {
    visit(node.init, scope, filePath, violationsMap);
  }

  if (declarationKind === 'const' && node.id.type === 'Identifier') {
    const constValue = resolveConstValue(node.init, scope);
    if (constValue !== null) {
      scope.setConstValue(node.id.name, constValue);
    }
  }

  const sourceKind = resolveValueKind(node.init, scope);
  if (!sourceKind) {
    visit(node.id, scope, filePath, violationsMap);
    return;
  }

  if (node.id.type === 'Identifier') {
    scope.setValueKind(node.id.name, sourceKind);
    recordViolation(
      violationsMap,
      filePath,
      node,
      sourceKind === 'guard-global' ? GLOBAL_ALIAS_MESSAGE : ELECTRON_API_ALIAS_MESSAGE
    );
    return;
  }

  recordPattern(node.id, sourceKind, scope, filePath, violationsMap);
}

function handleAssignmentExpression(node, scope, filePath, violationsMap) {
  visit(node.right, scope, filePath, violationsMap);
  visit(node.left, scope, filePath, violationsMap);

  if (node.operator !== '=') {
    return;
  }

  const sourceKind = resolveValueKind(node.right, scope);
  if (!sourceKind) {
    return;
  }

  if (node.left.type === 'Identifier') {
    scope.setValueKind(node.left.name, sourceKind);
    recordViolation(
      violationsMap,
      filePath,
      node,
      sourceKind === 'guard-global' ? GLOBAL_ALIAS_MESSAGE : ELECTRON_API_ALIAS_MESSAGE
    );
    return;
  }

  recordPattern(node.left, sourceKind, scope, filePath, violationsMap);
}

function handleMemberExpression(node, scope, filePath, violationsMap) {
  visit(node.object, scope, filePath, violationsMap);
  visit(node.property, scope, filePath, violationsMap);

  const objectKind = resolveValueKind(node.object, scope);
  if (objectKind !== 'guard-global') {
    return;
  }

  const key = resolvePropertyKey(node.property, node.computed, scope);
  if (key === ELECTRON_API_KEY) {
    recordViolation(violationsMap, filePath, node, DIRECT_ACCESS_MESSAGE);
  }
}

function visit(node, scope, filePath, violationsMap) {
  if (!isNode(node)) {
    return;
  }

  switch (node.type) {
    case 'Program': {
      const programScope = new Scope(scope);
      for (const statement of node.body) {
        visit(statement, programScope, filePath, violationsMap);
      }
      return;
    }
    case 'BlockStatement': {
      const blockScope = new Scope(scope);
      for (const statement of node.body) {
        visit(statement, blockScope, filePath, violationsMap);
      }
      return;
    }
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const functionScope = new Scope(scope);
      for (const param of node.params ?? []) {
        visit(param, functionScope, filePath, violationsMap);
      }
      visit(node.body, functionScope, filePath, violationsMap);
      return;
    }
    case 'VariableDeclaration':
      for (const declaration of node.declarations) {
        handleVariableDeclarator(declaration, scope, filePath, violationsMap, node.kind);
      }
      return;
    case 'AssignmentExpression':
      handleAssignmentExpression(node, scope, filePath, violationsMap);
      return;
    case 'MemberExpression':
      handleMemberExpression(node, scope, filePath, violationsMap);
      return;
    default:
      for (const child of getChildNodes(node)) {
        visit(child, scope, filePath, violationsMap);
      }
  }
}

async function collectRendererFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRendererFiles(fullPath)));
      continue;
    }
    if (TARGET_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

const filePaths = (await collectRendererFiles(rendererRoot))
  .map((filePath) => normalizePath(path.relative(repoRoot, filePath)))
  .sort();

const currentEntriesMap = new Map();
for (const relativeFilePath of filePaths) {
  const absoluteFilePath = path.join(repoRoot, relativeFilePath);
  const source = await fs.readFile(absoluteFilePath, 'utf8');
  const ast = parser.parse(source, {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 'latest',
    filePath: absoluteFilePath,
    loc: true,
    range: true,
    sourceType: 'module',
  });

  visit(ast, null, relativeFilePath, currentEntriesMap);
}

const currentEntries = [...currentEntriesMap.values()].sort((left, right) =>
  createSignature(left).localeCompare(createSignature(right))
);

if (updateBaseline) {
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.writeFile(
    baselinePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ruleId: RULE_ID,
        entries: currentEntries,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `Updated renderer bridge guardrail baseline at ${normalizePath(path.relative(repoRoot, baselinePath))}`
  );
  console.log(JSON.stringify(summarize(currentEntries), null, 2));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
} catch (error) {
  console.error(
    'Missing renderer bridge guardrail baseline. Run `npm run guardrails:bridge:update-baseline` first.'
  );
  throw error;
}

const baselineEntries = new Map(
  (baseline.entries ?? []).map((entry) => [createSignature(entry), entry.count])
);

const regressions = [];
for (const entry of currentEntries) {
  const signature = createSignature(entry);
  const baselineCount = baselineEntries.get(signature) ?? 0;
  if (entry.count > baselineCount) {
    regressions.push({ ...entry, baselineCount });
  }
}

if (regressions.length > 0) {
  console.error('Renderer bridge guardrail regression detected:');
  for (const regression of regressions) {
    console.error(
      `- ${regression.filePath}:${regression.line ?? '?'}:${regression.column ?? '?'} [${regression.ruleId}] baseline=${regression.baselineCount} current=${regression.count}`
    );
    console.error(`  ${regression.message}`);
  }
  process.exit(1);
}

console.log('Renderer bridge guardrail baseline check passed.');
console.log(JSON.stringify(summarize(currentEntries), null, 2));
