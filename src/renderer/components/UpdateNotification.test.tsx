// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotification } from './UpdateNotification';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electronAPI');
  vi.restoreAllMocks();
});

describe('UpdateNotification release notes', () => {
  it('renders provider HTML as formatted content instead of literal tags', async () => {
    const status = {
      checking: false,
      available: true,
      downloaded: false,
      downloading: false,
      error: null,
      progress: null,
      updateInfo: {
        version: '0.2.27',
        releaseDate: '2026-09-10T00:00:00.000Z',
        releaseNotes: '<h3>주요 변경</h3><p><strong>안전한 노트</strong></p>',
      },
    };

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        updater: {
          onStatusChange: (callback: (value: unknown) => void) => {
            callback(status);
            return vi.fn();
          },
          getStatus: vi.fn().mockResolvedValue(status),
          check: vi.fn(),
          download: vi.fn(),
          install: vi.fn(),
          setAutoDownload: vi.fn(),
          openReleaseNotesLink: vi.fn(),
        },
      },
    });

    render(<UpdateNotification />);

    expect(await screen.findByText('안전한 노트')).toBeTruthy();
    expect(screen.queryByText('<strong>안전한 노트</strong>')).toBeNull();
    expect(screen.getByRole('heading', { name: '주요 변경' })).toBeTruthy();
  });
});
