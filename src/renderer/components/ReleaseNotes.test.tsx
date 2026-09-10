// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseNotes } from './ReleaseNotes';
import type { UpdateReleaseNotes } from '../../types/updater';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electronAPI');
  vi.restoreAllMocks();
});

describe('ReleaseNotes', () => {
  it('sanitizes executable markup while preserving release formatting', () => {
    render(
      <ReleaseNotes
        releaseNotes={
          '<h3>변경</h3><ul><li><strong>안전</strong></li></ul><script>alert(1)</script><style>body{display:none}</style><svg><script>bad()</script></svg><img src="x" onerror="bad()" />'
        }
      />
    );

    const notes = screen.getByTestId('release-notes');
    expect(screen.getByRole('heading', { name: '변경' })).toBeTruthy();
    expect(screen.getByText('안전')).toBeTruthy();
    expect(notes.querySelector('script,style,svg,img')).toBeNull();
    expect(notes.innerHTML).not.toContain('onerror');
  });

  it('passes only http(s) links to the main process for every activation path', () => {
    const openReleaseNotesLink = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { updater: { openReleaseNotesLink } },
    });

    render(
      <ReleaseNotes
        releaseNotes={
          '<a href="https://example.com/release">문서</a><a href="javascript:alert(1)">위험</a>'
        }
      />
    );

    const link = screen.getByRole('link', { name: '문서' });
    fireEvent.click(link);
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.keyDown(link, { key: ' ' });
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(openReleaseNotesLink).toHaveBeenCalledTimes(4);
    expect(openReleaseNotesLink).toHaveBeenCalledWith('https://example.com/release');
    expect(screen.queryByRole('link', { name: '위험' })).toBeNull();
  });

  it('renders full-changelog entries with versions and keeps plain-text newlines', () => {
    const notes: UpdateReleaseNotes = [
      { version: '0.2.27', note: '<p>첫 번째</p>' },
      { version: '0.2.26', note: null },
      { version: '0.2.25', note: '두 번째\n줄' },
    ];

    render(<ReleaseNotes releaseNotes={notes} />);

    expect(screen.getByRole('heading', { name: 'v0.2.27' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'v0.2.25' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'v0.2.26' })).toBeNull();
    expect(screen.getByTestId('release-notes').textContent).toContain('두 번째\n줄');
  });

  it.each([undefined, null, '', '   \n ', []])('renders no notes for %p', (releaseNotes) => {
    const { container } = render(
      <ReleaseNotes releaseNotes={releaseNotes as UpdateReleaseNotes} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('keeps code, table spans, numbered lists and strike-through without source attributes', () => {
    render(
      <ReleaseNotes
        releaseNotes={
          '<ol start="3"><li><del>old</del> new</li></ol><pre><code>&lt;dependency&gt;</code></pre><table><tbody><tr><td colspan="2" style="position:fixed" data-source="remote" aria-label="fake">cell</td></tr></tbody></table>'
        }
      />
    );
    const notes = screen.getByTestId('release-notes');
    expect(notes.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(notes.querySelector('del')?.textContent).toBe('old');
    expect(notes.querySelector('code')?.textContent).toBe('<dependency>');
    expect(notes.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(notes.querySelector('[style], [data-source], [aria-label]')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///tmp/notes',
    '//example.com',
    '/relative',
  ])('removes unsafe or relative URL %s', (href) => {
    render(<ReleaseNotes releaseNotes={`<p><a href="${href}">link</a></p>`} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('link')).toBeTruthy();
  });

  it.each(['failure', 'rejected'])('reports a %s browser-open result', async (mode) => {
    const error = vi.spyOn(message, 'error').mockImplementation(() => (() => undefined) as never);
    const openReleaseNotesLink =
      mode === 'failure'
        ? vi.fn().mockResolvedValue({ success: false, error: '브라우저 오류' })
        : vi.fn().mockRejectedValue(new Error('IPC unavailable'));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { updater: { openReleaseNotesLink } },
    });
    render(<ReleaseNotes releaseNotes='<a href="https://example.com">문서</a>' />);
    fireEvent.click(screen.getByRole('link', { name: '문서' }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        mode === 'failure' ? '브라우저 오류' : '릴리즈 노트 링크를 열 수 없습니다.'
      )
    );
  });
});
