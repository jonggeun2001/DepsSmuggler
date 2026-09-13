#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Package locally; the release workflow publishes only after metadata validation.
// Deduplicate explicit --publish never: electron-builder treats repeated values as an array.
const argumentsToForward = [];
const supplied = process.argv.slice(2);
try {
  for (let index = 0; index < supplied.length; index++) {
    const argument = supplied[index];
    if (argument === '--publish' || argument === '-p' || argument.startsWith('--publish=') || argument.startsWith('-p=')) {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : supplied[++index];
      if (value !== 'never') throw new Error('macOS packages must be validated before publishing through the release workflow');
    } else {
      argumentsToForward.push(argument);
    }
  }
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', ...argumentsToForward, '--publish', 'never'], {
    stdio: 'inherit',
  });
  child.once('error', error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
