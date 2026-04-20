import { ESLint } from 'eslint';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_RULE_IDS = [
  'boundaries/dependencies',
  'import/no-cycle',
  'import/no-internal-modules',
  'import/no-restricted-paths',
  'no-restricted-syntax',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(repoRoot, 'config/guardrails/eslint-guardrails-baseline.json');
const updateBaseline = process.argv.includes('--update');

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function createSignature(entry) {
  return JSON.stringify({
    filePath: entry.filePath,
    ruleId: entry.ruleId,
    message: entry.message,
  });
}

function summarize(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.ruleId] = (summary[entry.ruleId] ?? 0) + entry.count;
    return summary;
  }, {});
}

const eslint = new ESLint({ cwd: repoRoot, cache: false });
const results = await eslint.lintFiles([
  'electron/**/*.ts',
  'src/**/*.{ts,tsx,js,jsx}',
  'tests/**/*.{ts,tsx,js,jsx}',
]);

const currentEntriesMap = new Map();
for (const result of results) {
  const filePath = normalizePath(path.relative(repoRoot, result.filePath));

  for (const message of result.messages) {
    if (!message.ruleId || !TARGET_RULE_IDS.includes(message.ruleId)) {
      continue;
    }

    const entry = {
      filePath,
      ruleId: message.ruleId,
      message: message.message,
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
        rules: TARGET_RULE_IDS,
        entries: currentEntries,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `Updated ESLint guardrail baseline at ${normalizePath(path.relative(repoRoot, baselinePath))}`
  );
  console.log(JSON.stringify(summarize(currentEntries), null, 2));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
} catch (error) {
  console.error(
    'Missing ESLint guardrail baseline. Run `npm run guardrails:eslint:update-baseline` first.'
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
  console.error('ESLint guardrail baseline regression detected:');
  for (const regression of regressions) {
    console.error(
      `- ${regression.filePath} [${regression.ruleId}] baseline=${regression.baselineCount} current=${regression.count}`
    );
    console.error(`  ${regression.message}`);
  }
  process.exit(1);
}

console.log('ESLint guardrail baseline check passed.');
console.log(JSON.stringify(summarize(currentEntries), null, 2));
