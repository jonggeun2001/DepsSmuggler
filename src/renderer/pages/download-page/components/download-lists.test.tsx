// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadItemsTable } from './DownloadItemsTable';
import { DownloadLogsCard } from './DownloadLogsCard';
import type { DownloadStoreItem, LogEntry } from '../../../stores/download-store';

beforeEach(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const item = (id: string, extra: Partial<DownloadStoreItem> = {}): DownloadStoreItem => ({
  id,
  name: id,
  version: '1',
  status: 'completed',
  progress: 100,
  downloadedBytes: 100,
  totalBytes: 100,
  speed: 0,
  ...extra,
});
const logs = (count: number): LogEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`,
    timestamp: 1000 + i,
    level: 'info',
    message: `message-${i}`,
    details: `detail-${i}`,
  }));
const displayedLogIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-log-id]'), (node) =>
    node.getAttribute('data-log-id')
  );

describe('bounded dependency display', () => {
  it('pages all 999 dependencies, keeps full counts/errors/retry and retains the selected page on updates', () => {
    const root = item('root', { status: 'failed', error: 'root error' });
    const children = Array.from({ length: 999 }, (_, i) =>
      item(`child-${i + 1}`, { isDependency: true, parentId: root.id })
    );
    children[998] = { ...children[998], status: 'failed', error: 'last child error' };
    const onRetry = vi.fn();
    const { container, rerender } = render(
      <DownloadItemsTable
        downloadItems={[root, ...children]}
        showDependenciesTree
        onRetry={onRetry}
      />
    );
    expect(container.querySelectorAll('[data-download-item-id]')).toHaveLength(10);
    expect(screen.getByText('998/1000 완료')).toBeTruthy();
    expect(screen.getByText('2 실패')).toBeTruthy();
    expect(screen.getByText('root error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /재시도/ }));
    expect(onRetry).toHaveBeenLastCalledWith(root);
    const section = screen.getByRole('region', { name: 'root 의존성 목록' });
    fireEvent.click(within(section).getByTitle('100'));
    expect(container.querySelectorAll('[data-download-item-id]')).toHaveLength(9);
    expect(screen.queryByText('child-1')).toBeNull();
    expect(screen.getByText('last child error')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /재시도/ }));
    expect(onRetry).toHaveBeenLastCalledWith(children[998]);
    const next = { ...children[998], error: 'updated error' };
    children[998] = next;
    rerender(
      <DownloadItemsTable
        downloadItems={[{ ...root, status: 'completed' }, ...children]}
        showDependenciesTree
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('999/1000 완료')).toBeTruthy();
    expect(screen.getByText('updated error')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /재시도/ }));
    expect(onRetry).toHaveBeenLastCalledWith(next);
  });

  it('bounds the group count and keeps collapse state across pages and progress updates', () => {
    const items = Array.from({ length: 21 }, (_, i) => item(`root-${i}`));
    const onRetry = vi.fn();
    const { container, rerender } = render(
      <DownloadItemsTable downloadItems={items} showDependenciesTree onRetry={onRetry} />
    );
    expect(container.querySelectorAll('.ant-collapse-item')).toHaveLength(10);
    const firstHeader = screen.getByText('root-0').closest('.ant-collapse-header')!;
    fireEvent.click(firstHeader);
    expect(firstHeader.getAttribute('aria-expanded')).toBe('false');
    const pager = screen.getByRole('navigation', { name: '의존성 그룹 페이지' });
    fireEvent.click(within(pager).getByTitle('3'));
    expect(container.querySelectorAll('.ant-collapse-item')).toHaveLength(1);
    expect(screen.getByText('root-20')).toBeTruthy();
    fireEvent.click(within(pager).getByTitle('1'));
    expect(
      screen.getByText('root-0').closest('.ant-collapse-header')?.getAttribute('aria-expanded')
    ).toBe('false');
    rerender(
      <DownloadItemsTable
        downloadItems={items.map((value, i) => (i === 1 ? { ...value, progress: 50 } : value))}
        showDependenciesTree
        onRetry={onRetry}
      />
    );
    expect(
      screen.getByText('root-0').closest('.ant-collapse-header')?.getAttribute('aria-expanded')
    ).toBe('false');
  });

  it('keeps each dependency page after unmounting a closed or off-page group', async () => {
    const root = item('root');
    const children = Array.from({ length: 12 }, (_, i) =>
      item(`dep-${i}`, { parentId: root.id, isDependency: true })
    );
    const items = [root, ...children, ...Array.from({ length: 10 }, (_, i) => item(`other-${i}`))];
    const { container, rerender } = render(
      <DownloadItemsTable downloadItems={items} showDependenciesTree onRetry={vi.fn()} />
    );
    fireEvent.click(
      within(screen.getByRole('region', { name: 'root 의존성 목록' })).getByTitle('2')
    );
    expect(screen.getByText('dep-11')).toBeTruthy();
    const header = screen.getByText('root').closest('.ant-collapse-header')!;
    fireEvent.click(header);
    await waitFor(() =>
      expect(container.querySelectorAll('[data-download-item-id]')).toHaveLength(0)
    );
    fireEvent.click(header);
    expect(screen.getByText('dep-11')).toBeTruthy();
    const pager = screen.getByRole('navigation', { name: '의존성 그룹 페이지' });
    fireEvent.click(within(pager).getByTitle('2'));
    expect(screen.queryByText('dep-11')).toBeNull();
    fireEvent.click(within(pager).getByTitle('1'));
    expect(screen.getByText('dep-11')).toBeTruthy();
    fireEvent.click(within(pager).getByTitle('2'));
    rerender(
      <DownloadItemsTable
        downloadItems={[root, ...children]}
        showDependenciesTree
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText('root')).toBeTruthy();
    expect(screen.getByText('dep-11')).toBeTruthy();
  });

  it('does not reread unchanged dependency row content and uses a changed retry callback', () => {
    const root = item('root');
    const first = item('first', { parentId: root.id, isDependency: true, status: 'failed' });
    const second = item('second', { parentId: root.id, isDependency: true });
    let reads = 0;
    Object.defineProperty(first, 'name', {
      get: () => {
        reads++;
        return 'first';
      },
    });
    const onRetry = vi.fn();
    const { rerender } = render(
      <DownloadItemsTable
        downloadItems={[root, first, second]}
        showDependenciesTree
        onRetry={onRetry}
      />
    );
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    rerender(
      <DownloadItemsTable
        downloadItems={[root, first, { ...second, progress: 50 }]}
        showDependenciesTree
        onRetry={onRetry}
      />
    );
    expect(reads).toBe(0);
    const nextRetry = vi.fn();
    rerender(
      <DownloadItemsTable
        downloadItems={[root, first, second]}
        showDependenciesTree
        onRetry={nextRetry}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /재시도/ }));
    expect(nextRetry).toHaveBeenCalledWith(first);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retains 10 rows for the standard progress table and the complete outcome table', () => {
    const items = Array.from({ length: 13 }, (_, i) => item(`normal-${i}`));
    const onRetry = vi.fn();
    const { container, rerender } = render(
      <DownloadItemsTable
        downloadItems={items}
        showDependenciesTree={false}
        onRetry={onRetry}
        paginate
      />
    );
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(10);
    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByText('normal-12')).toBeTruthy();
    rerender(
      <DownloadItemsTable
        downloadItems={items}
        showDependenciesTree={false}
        onRetry={onRetry}
        paginate={false}
      />
    );
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(13);
  });
});

describe('bounded full log access', () => {
  it('shows 50 rows, keeps duplicate events and details, reaches every page and clamps on clear', () => {
    const entries = logs(5000);
    entries[0] = { ...entries[0], message: 'repeat', level: 'error' };
    entries[1] = { ...entries[1], message: 'repeat', level: 'error' };
    const { container, rerender } = render(<DownloadLogsCard logs={entries} />);
    expect(displayedLogIds(container)).toEqual(entries.slice(0, 50).map((log) => log.id));
    expect(screen.getAllByText('repeat', { exact: false })).toHaveLength(2);
    expect(screen.getByText(/detail-0$/)).toBeTruthy();
    const pager = screen.getByRole('navigation', { name: '로그 페이지' });
    fireEvent.click(within(pager).getByTitle('100'));
    expect(displayedLogIds(container)).toEqual(entries.slice(4950).map((log) => log.id));
    const appended = { ...entries[0], id: 'new', message: 'new event' };
    rerender(<DownloadLogsCard logs={[...entries, appended]} />);
    expect(displayedLogIds(container)).toEqual(entries.slice(4950).map((log) => log.id));
    fireEvent.click(within(pager).getByTitle('101'));
    expect(screen.getByText(/new event/)).toBeTruthy();
    rerender(<DownloadLogsCard logs={[]} />);
    expect(displayedLogIds(container)).toEqual([]);
    expect(screen.getByText('로그가 없습니다')).toBeTruthy();
    rerender(<DownloadLogsCard logs={entries.slice(0, 51)} />);
    expect(displayedLogIds(container)).toEqual(entries.slice(0, 50).map((log) => log.id));
  });

  it('does not reread unchanged logs on progress or append and still reflects a changed entry', () => {
    const entries = logs(50);
    let reads = 0;
    Object.defineProperty(entries[0], 'message', {
      get: () => {
        reads++;
        return 'observed';
      },
    });
    const style = { marginTop: 16 };
    const { rerender } = render(<DownloadLogsCard logs={entries} style={style} />);
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    rerender(<DownloadLogsCard logs={entries} style={style} />);
    expect(reads).toBe(0);
    rerender(
      <DownloadLogsCard logs={[...entries, { ...entries[1], id: 'appended' }]} style={style} />
    );
    expect(reads).toBe(0);
    rerender(
      <DownloadLogsCard
        logs={[{ ...entries[0], message: 'changed' }, ...entries.slice(1)]}
        style={style}
      />
    );
    expect(screen.getByText(/changed/)).toBeTruthy();
  });
});
