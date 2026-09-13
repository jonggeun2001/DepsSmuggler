'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const target = process.env.ATOMIC_JSON_TARGET;
const value = JSON.parse(process.env.ATOMIC_JSON_VALUE || 'null');
const mode = process.env.ATOMIC_JSON_MODE;
if (!target) throw new Error('ATOMIC_JSON_TARGET is required');

function disconnectAfterMessage(message) {
  if (!process.send) {
    process.exit(0);
    return;
  }
  process.send(message, () => {
    if (process.connected) process.disconnect();
  });
}

if (mode === 'read-target') {
  try {
    disconnectAfterMessage({
      type: 'read',
      value: JSON.parse(fs.readFileSync(target, 'utf8')),
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
} else {
  const ts = require(path.join(process.env.DEPS_SMUGGLER_PROJECT_ROOT, 'node_modules/typescript'));
  const originalLoad = Module._load;
  let releaseRename;
  const release = new Promise((resolve) => { releaseRename = resolve; });
  let releaseAfterRename;
  const afterRenameRelease = new Promise((resolve) => { releaseAfterRename = resolve; });

  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (request !== 'node:fs/promises' && request !== 'fs/promises') return loaded;
    return {
      ...loaded,
      rename: async (tempPath, targetPath) => {
        if (process.send) process.send({ type: 'before-rename', tempPath, targetPath });
        if (
          mode === 'hold-before-rename' ||
          mode === 'release-after-boundary' ||
          mode === 'hold-after-rename'
        ) await release;
        const result = await loaded.rename(tempPath, targetPath);
        if (process.send) process.send({ type: 'after-rename', tempPath, targetPath });
        if (mode === 'hold-after-rename') await afterRenameRelease;
        return result;
      },
    };
  };

  process.on('message', (message) => {
    if (message === 'release') releaseRename();
    if (message === 'release-after-rename') releaseAfterRename();
  });

  const sourcePath = path.join(
    process.env.DEPS_SMUGGLER_PROJECT_ROOT,
    'src/core/shared/atomic-json-store.ts'
  );
  const compiledPath = process.env.ATOMIC_JSON_COMPILED_HELPER;
  if (!compiledPath) throw new Error('ATOMIC_JSON_COMPILED_HELPER is required');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  fs.writeFileSync(compiledPath, compiled, 'utf8');
  const { writeJsonAtomically } = require(compiledPath);

  writeJsonAtomically(target, value)
    .then(() => disconnectAfterMessage({ type: 'done' }))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    });
}
