import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerRootCaHandlers } from './root-ca-handlers';
import { readRootCaCertificates } from '../src/core/root-ca-store';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  homedir: vi.fn(),
}));
let home: string;
let selected: string;
const pem = readFileSync(path.resolve('electron/test-fixtures/tls-cert.pem'));

beforeEach(() => {
  vi.clearAllMocks();
  home = mkdtempSync(path.join(os.tmpdir(), 'root-ca-ipc-'));
  vi.mocked(os.homedir).mockReturnValue(home);
  selected = path.join(home, 'company.cer');
  writeFileSync(selected, pem);
  registerRootCaHandlers();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function invoke(channel: string) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  if (!handler) throw new Error('Missing handler');
  return handler({});
}

it('imports from the native picker, reports pending restart and shares persistence with CLI', async () => {
  mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] });
  await expect(invoke('root-ca:import')).resolves.toMatchObject({
    success: true,
    status: {
      restartRequired: true,
      certificates: [expect.objectContaining({ subject: 'CN=localhost' })],
    },
  });
  expect(readRootCaCertificates()).toHaveLength(1);
  await expect(invoke('root-ca:get')).resolves.toMatchObject({ success: true });
  await expect(invoke('root-ca:clear')).resolves.toMatchObject({
    success: true,
    status: { certificates: [], restartRequired: false },
  });
});

it('reports cancellation and invalid imports without changing the saved CA', async () => {
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selected] });
  await invoke('root-ca:import');
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  await expect(invoke('root-ca:import')).resolves.toMatchObject({ success: true, canceled: true });
  writeFileSync(selected, 'not a certificate');
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selected] });
  await expect(invoke('root-ca:import')).resolves.toMatchObject({
    success: false,
    error: expect.stringContaining('X.509'),
  });
  expect(readRootCaCertificates()).toHaveLength(1);
});
