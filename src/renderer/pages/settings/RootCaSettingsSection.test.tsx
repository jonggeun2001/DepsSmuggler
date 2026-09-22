// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RootCaSettingsSection } from './RootCaSettingsSection';

const certificate = {
  subject: 'CN=Company Root',
  issuer: 'CN=Company Root',
  fingerprint: 'AA:BB',
  validTo: '2036-01-01T00:00:00Z',
};
const empty = { success: true, status: { certificates: [], restartRequired: false } };

function installApi() {
  const api = { get: vi.fn().mockResolvedValue(empty), import: vi.fn(), clear: vi.fn() };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { rootCa: api } });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
  });
  return api;
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

it('shows persisted certificate details, restart guidance and removal', async () => {
  const api = installApi();
  api.import.mockResolvedValue({
    success: true,
    status: { certificates: [certificate], restartRequired: true },
  });
  api.clear.mockResolvedValue({
    success: true,
    status: { certificates: [], restartRequired: true },
  });
  await act(async () => {
    render(<RootCaSettingsSection />);
  });
  const register = await screen.findByRole('button', { name: '인증서 파일 등록' });
  await waitFor(() => expect((register as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(register);
  });
  await screen.findByText('AA:BB');
  await screen.findByRole('button', { name: '인증서 파일 등록' });
  expect(
    screen.getByText('CA 설정을 적용하려면 앱을 완전히 종료한 뒤 다시 실행하세요.')
  ).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '등록 해제' }));
  });
  await screen.findByText('등록된 추가 CA가 없습니다');
  expect(api.clear).toHaveBeenCalledOnce();
});

it('shows IPC failure and preserves the previously registered certificate', async () => {
  const api = installApi();
  api.get.mockResolvedValue({
    success: true,
    status: { certificates: [certificate], restartRequired: false },
  });
  api.import.mockResolvedValue({ success: false, error: '인증서 형식 오류' });
  await act(async () => {
    render(<RootCaSettingsSection />);
  });
  await screen.findByText('AA:BB');
  fireEvent.click(await screen.findByRole('button', { name: '인증서 파일 등록' }));
  await waitFor(() => expect(screen.getAllByText('인증서 형식 오류').length).toBeGreaterThan(0));
  expect(screen.getByText('AA:BB')).toBeTruthy();
});

it('does not offer registration in a browser without the native API', () => {
  render(<RootCaSettingsSection />);
  expect(
    (screen.getByRole('button', { name: '인증서 파일 등록' }) as HTMLButtonElement).disabled
  ).toBe(true);
});
