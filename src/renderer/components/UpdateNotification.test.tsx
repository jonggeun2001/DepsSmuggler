// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import { parseXml } from 'builder-util-runtime';
import { computeReleaseNotes } from 'electron-updater/out/providers/GitHubProvider';
import { SemVer } from 'semver';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotification } from './UpdateNotification';
import type { UpdaterStatus } from '../../types/electron';

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  message: { error: vi.fn(), info: vi.fn() },
}));

const available = {
  checking: false,
  available: true,
  downloaded: false,
  downloading: false,
  error: null,
  progress: null,
  updateInfo: {
    version: '0.2.30',
    releaseDate: '2026-09-22T00:00:00.000Z',
    releaseNotes: '<h3>주요 변경</h3><p><strong>안전한 노트</strong></p>',
  },
} satisfies UpdaterStatus;

function renderNotification() {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <UpdateNotification />
    </ConfigProvider>
  );
}

function installUpdater(getStatus: () => Promise<UpdaterStatus>) {
  let listener: (value: UpdaterStatus) => void = () => {};
  const unsubscribe = vi.fn();
  const openReleaseNotesLink = vi.fn().mockResolvedValue({ success: true });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      updater: {
        onStatusChange: (callback: typeof listener) => {
          listener = callback;
          return unsubscribe;
        },
        getStatus,
        download: vi.fn(),
        install: vi.fn(),
        openReleaseNotesLink,
      },
    },
  });
  return { emit: (status: UpdaterStatus) => listener(status), unsubscribe, openReleaseNotesLink };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electronAPI');
  vi.clearAllMocks();
});

describe('UpdateNotification release notes', () => {
  it.each([
    ['새 버전 발견', available],
    ['새 버전 발견', { ...available, downloading: true }],
    ['업데이트 준비 완료', { ...available, downloaded: true }],
  ] as const)(
    'restores the %s dialog from the initial snapshot without a broadcast',
    async (title, status) => {
      installUpdater(async () => status);
      renderNotification();

      expect(await screen.findByRole('dialog', { name: new RegExp(`${title}$`) })).toBeTruthy();
      expect(screen.getByText('안전한 노트')).toBeTruthy();
      expect(screen.queryByText('<strong>안전한 노트</strong>')).toBeNull();
      expect(screen.getByRole('heading', { name: '주요 변경' })).toBeTruthy();
    }
  );

  it.each([false, true])(
    'ignores a delayed snapshot after a newer event (dismissed: %s)',
    async (dismissed) => {
      let resolveSnapshot!: (status: UpdaterStatus) => void;
      const updater = installUpdater(
        () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve;
          })
      );
      renderNotification();
      act(() => updater.emit({ ...available, downloaded: true }));
      expect(await screen.findByRole('button', { name: /지금 재시작$/ })).toBeTruthy();
      if (dismissed) fireEvent.click(screen.getByRole('button', { name: '나중에 설치' }));

      await act(async () => resolveSnapshot(available));
      if (dismissed) {
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      } else {
        expect(screen.getByRole('button', { name: /지금 재시작$/ })).toBeTruthy();
      }
      expect(screen.queryByRole('button', { name: /다운로드$/ })).toBeNull();
    }
  );

  it('restores a download when its progress event precedes the initial snapshot', async () => {
    let resolveSnapshot!: (status: UpdaterStatus) => void;
    const updater = installUpdater(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    renderNotification();
    act(() =>
      updater.emit({
        ...available,
        downloading: true,
        progress: { percent: 42, bytesPerSecond: 1, total: 100, transferred: 42 },
      })
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('안전한 노트')).toBeTruthy();
    await act(async () => resolveSnapshot({ ...available, available: false, updateInfo: null }));
    expect(screen.getByRole('button', { name: /다운로드 중/ })).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('ignores a pending initial response after unmount and unsubscribes', async () => {
    let resolveSnapshot!: (status: UpdaterStatus) => void;
    const updater = installUpdater(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    const { unmount } = renderNotification();
    unmount();
    await act(async () => resolveSnapshot({ ...available, error: 'late error' }));
    expect(updater.unsubscribe).toHaveBeenCalledOnce();
    expect(message.error).not.toHaveBeenCalled();
  });

  it('reports an initial IPC failure and still accepts later status events', async () => {
    const updater = installUpdater(async () => {
      throw new Error('IPC failed');
    });
    renderNotification();
    await waitFor(() => expect(message.error).toHaveBeenCalledOnce());
    act(() => updater.emit(available));
    expect(await screen.findByText('안전한 노트')).toBeTruthy();
  });

  it('shows a release link for an empty GitHub Atom body through the real provider conversion', async () => {
    // Published v0.2.30 had no body, so GitHub returned this Atom content.
    const feed = parseXml(
      '<feed><entry><title>v0.2.30</title><content>No content.</content></entry></feed>'
    );
    const notes = computeReleaseNotes(new SemVer('0.2.29'), false, feed, feed.element('entry'));
    expect(notes).toBe('');
    const updater = installUpdater(async () => ({
      ...available,
      updateInfo: { ...available.updateInfo, releaseNotes: notes },
    }));
    renderNotification();

    expect(await screen.findByText('이 버전의 변경 사항이 제공되지 않았습니다.')).toBeTruthy();
    expect(screen.getByText('릴리스 이력')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'GitHub 릴리스 보기' }));
    expect(updater.openReleaseNotesLink).toHaveBeenCalledWith(
      'https://github.com/jonggeun2001/DepsSmuggler/releases/tag/v0.2.30'
    );
    expect(screen.getByRole('button', { name: /다운로드$/ })).toBeTruthy();
  });
});
