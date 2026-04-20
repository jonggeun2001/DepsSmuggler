import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'tsconfig.strict-baseline.json');
const baselinePath = path.join(repoRoot, 'config/guardrails/typecheck-strict-baseline.json');
const updateBaseline = process.argv.includes('--update');

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function flattenMessage(messageText) {
  return ts.flattenDiagnosticMessageText(messageText, '\n');
}

function createSignature(entry) {
  return JSON.stringify({
    filePath: entry.filePath,
    code: entry.code,
    message: entry.message,
    line: entry.line,
    column: entry.column,
    endLine: entry.endLine,
    endColumn: entry.endColumn,
  });
}

function getDiagnosticLocation(diagnostic) {
  if (!diagnostic.file || diagnostic.start === undefined) {
    return {
      line: null,
      column: null,
      endLine: null,
      endColumn: null,
    };
  }

  const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const endPosition = diagnostic.start + (diagnostic.length ?? 0);
  const end = diagnostic.file.getLineAndCharacterOfPosition(endPosition);

  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  throw new Error(flattenMessage(configFile.error.messageText));
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  repoRoot,
  undefined,
  configPath
);
const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});

const currentEntriesMap = new Map();
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  if (diagnostic.category !== ts.DiagnosticCategory.Error) {
    continue;
  }

  const entry = {
    filePath: diagnostic.file
      ? normalizePath(path.relative(repoRoot, diagnostic.file.fileName))
      : '<config>',
    code: `TS${diagnostic.code}`,
    message: flattenMessage(diagnostic.messageText),
    ...getDiagnosticLocation(diagnostic),
    count: 1,
  };
  const signature = createSignature(entry);
  const existing = currentEntriesMap.get(signature);
  if (existing) {
    existing.count += 1;
  } else {
    currentEntriesMap.set(signature, entry);
  }
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
        configPath: normalizePath(path.relative(repoRoot, configPath)),
        entries: currentEntries,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `Updated strict typecheck baseline at ${normalizePath(path.relative(repoRoot, baselinePath))}`
  );
  console.log(
    `Tracked diagnostics: ${currentEntries.reduce((sum, entry) => sum + entry.count, 0)}`
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
} catch (error) {
  console.error(
    'Missing strict typecheck baseline. Run `npm run guardrails:typecheck:update-baseline` first.'
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
  console.error('Strict typecheck baseline regression detected:');
  for (const regression of regressions) {
    console.error(
      `- ${regression.filePath}:${regression.line ?? '?'}:${regression.column ?? '?'} [${regression.code}] baseline=${regression.baselineCount} current=${regression.count}`
    );
    console.error(`  ${regression.message}`);
  }
  process.exit(1);
}

console.log('Strict typecheck baseline check passed.');
console.log(`Tracked diagnostics: ${currentEntries.reduce((sum, entry) => sum + entry.count, 0)}`);
