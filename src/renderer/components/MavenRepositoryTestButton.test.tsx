// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MavenRepositoryTestButton } from './MavenRepositoryTestButton';
import type { MavenRepositoryTestResult } from '../../types/maven-repository';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

function installApi() {
  const testRepository = vi.fn<(url: string) => Promise<MavenRepositoryTestResult>>();
  const save = vi.fn();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { maven: { testRepository }, config: { set: save } },
  });
  return { testRepository, save };
}

it('validates before IPC, shows connection results and never saves settings', async () => {
  const { testRepository, save } = installApi();
  const view = render(<MavenRepositoryTestButton url="file:///tmp/repo" />);
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }));
  await screen.findByText(/HTTP\(S\) URL/);
  expect(testRepository).not.toHaveBeenCalled();

  testRepository.mockResolvedValue({ success: true, status: 200, message: '연결 성공 (HTTP 200)' });
  view.rerender(<MavenRepositoryTestButton url=" https://repo.example.com/releases/ " />);
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }));
  await screen.findByText('연결 성공 (HTTP 200)');
  expect(testRepository).toHaveBeenCalledWith('https://repo.example.com/releases');
  expect(save).not.toHaveBeenCalled();
});

it('clears changed URLs and ignores an old response after a newer test', async () => {
  const { testRepository } = installApi();
  let finishOld!: (result: MavenRepositoryTestResult) => void;
  testRepository.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const view = render(<MavenRepositoryTestButton url="https://old.example.com" />);
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }));
  expect(
    (screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }) as HTMLButtonElement).disabled
  ).toBe(true);
  view.rerender(<MavenRepositoryTestButton url="https://new.example.com" />);
  testRepository.mockResolvedValueOnce({
    success: false,
    status: 404,
    message: '경로 확인 필요 (HTTP 404)',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }));
  await screen.findByText('경로 확인 필요 (HTTP 404)');
  await act(async () => finishOld({ success: true, message: 'old success' }));
  expect(screen.queryByText('old success')).toBeNull();
  view.rerender(<MavenRepositoryTestButton url="https://third.example.com" />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('reports an unavailable desktop API without simulating success', async () => {
  render(<MavenRepositoryTestButton url="https://repo.example.com" />);
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 연결 테스트' }));
  await screen.findByText('연결 테스트는 최신 Electron 앱에서 사용할 수 있습니다.');
});
