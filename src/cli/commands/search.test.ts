import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCommand } from './search';

const { searchPackages } = vi.hoisted(() => ({
  searchPackages: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: new Proxy(
    {},
    {
      get: () => (value: string) => value,
    }
  ),
}));

vi.mock('cli-table3', () => ({
  default: class TableMock {
    private rows: string[][] = [];

    push(row: string[]): void {
      this.rows.push(row);
    }

    toString(): string {
      return this.rows.map((row) => row.join(' | ')).join('\n');
    }
  },
}));

vi.mock('../../core/downloaders/pip', () => ({
  getPipDownloader: vi.fn(() => ({ searchPackages: vi.fn() })),
}));

vi.mock('../../core/downloaders/conda', () => ({
  getCondaDownloader: vi.fn(() => ({ searchPackages: vi.fn() })),
}));

vi.mock('../../core/downloaders/maven', () => ({
  getMavenDownloader: vi.fn(() => ({ searchPackages: vi.fn() })),
}));

vi.mock('../../core/downloaders/npm', () => ({
  getNpmDownloader: vi.fn(() => ({ searchPackages })),
}));

vi.mock('../../core/downloaders/docker', () => ({
  getDockerDownloader: vi.fn(() => ({ searchPackages: vi.fn() })),
}));

describe('searchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('npm 검색 결과를 기존 테이블 포맷으로 출력한다', async () => {
    searchPackages.mockResolvedValue([
      {
        type: 'npm',
        name: 'react',
        version: '19.2.0',
        metadata: {
          description: 'React is a JavaScript library for building user interfaces.',
        },
      },
      {
        type: 'npm',
        name: 'react-dom',
        version: '19.2.0',
        metadata: {
          description: 'React package for working with the DOM.',
        },
      },
    ]);

    await searchCommand('react', { type: 'npm', limit: '1' });

    expect(searchPackages).toHaveBeenCalledWith('react', 1);

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain("'react' 검색 중...");
    expect(output).toContain('✓ 1개 결과 찾음');
    expect(output).toContain('[NPM] 검색 결과:');
    expect(output).toContain('react | 19.2.0 | React is a JavaScript library for building user interfaces.');
    expect(output).not.toContain('react-dom');
    expect(output).toContain('depssmuggler download -t npm -p react -V 19.2.0');
  });

  it('npm 검색 결과가 없으면 기존 안내 문구를 출력한다', async () => {
    searchPackages.mockResolvedValue([]);

    await searchCommand('nonexistent-package', { type: 'npm', limit: '20' });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('✓ 0개 결과 찾음');
    expect(output).toContain('검색 결과가 없습니다');
  });

  it('npm 검색 limit이 잘못되면 기본값 20으로 보정한다', async () => {
    searchPackages.mockResolvedValue([]);

    await searchCommand('react', { type: 'npm', limit: 'invalid' });

    expect(searchPackages).toHaveBeenCalledWith('react', 20);
  });

  it('npm 검색 실패 시 기존 에러 처리와 동일하게 종료한다', async () => {
    searchPackages.mockRejectedValue(new Error('Network Error'));
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

    await expect(
      searchCommand('react', { type: 'npm', limit: '20' })
    ).rejects.toThrow('process.exit');

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    const errors = vi.mocked(console.error).mock.calls.flat().join('\n');

    expect(output).toContain('✗ 검색 실패');
    expect(errors).toContain('오류: Network Error');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
