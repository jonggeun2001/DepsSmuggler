import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppUpdater } from 'electron-updater/out/AppUpdater';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider';
import { afterEach, describe, expect, it, vi } from 'vitest';

class SupportProbe extends AppUpdater {
  constructor() {
    super(undefined, {
      version: '0.2.27', name: 'support-probe', isPackaged: true,
      appUpdateConfigPath: '', userDataPath: '', baseCachePath: '',
      whenReady: async () => {}, relaunch: () => {}, quit: () => {}, onQuit: () => {},
    });
    this.logger = null;
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
  }

  protected async doDownloadUpdate(): Promise<string[]> {
    throw new Error('Downloads must not run in the OS compatibility probe');
  }

  quitAndInstall(): void {
    throw new Error('Installation must not run in the OS compatibility probe');
  }
}

afterEach(() => vi.restoreAllMocks());

describe('macOS update OS eligibility', () => {
  it.each([
    ['21.6.0', false], // macOS 12
    ['22.0.0', true], // macOS 13
    ['23.6.0', true],
  ])('uses the configured release feed to check Darwin %s', async (release, supported) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mac-update-support-'));
    try {
      const file = path.join(directory, 'latest-mac.yml');
      await writeFile(file, 'version: 0.2.28\nfiles: []\n');
      await promisify(execFile)(process.execPath, [path.resolve('scripts/prepare-macos-update.mjs'), directory]);
      const info = parseUpdateInfo(await readFile(file, 'utf8'), 'latest-mac.yml', new URL('https://example.invalid/latest-mac.yml'));
      vi.spyOn(os, 'release').mockReturnValue(release);
      expect(await new SupportProbe().isUpdateSupported(info)).toBe(supported);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
