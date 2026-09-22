// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OSDownloadProgress } from './os/OSDownloadProgress';
import { PackagingProgressView } from './PackagingProgressView';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PackagingProgressView', () => {
  it('진행률을 모르는 스크립트 생성은 퍼센트 없이 단계와 경과 시간을 표시한다', () => {
    vi.useFakeTimers();
    const view = render(<PackagingProgressView message="설치 스크립트 생성 중..." />);
    expect(screen.getByRole('status').textContent).toBe('설치 스크립트 생성 중...');
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText(/경과 시간 2초/)).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('압축 중 처리 파일 수와 실제 기록 용량을 표시한다', () => {
    render(
      <PackagingProgressView
        message="ZIP 압축 중..."
        archiveProgress={{
          processedFiles: 1,
          totalFiles: 2,
          processedBytes: 50,
          totalBytes: 100,
          percentage: 50,
          outputBytes: 1024,
        }}
      />
    );
    expect(screen.getByText(/1 \/ 2개 파일 처리/).textContent).toContain('1.0 KB');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('OS 패키징에서는 다운로드 100%와 별도로 생성 상태를 표시한다', () => {
    render(
      <OSDownloadProgress
        packageCount={2}
        outputDir="/tmp/out"
        progress={{
          phase: 'packaging',
          currentPackage: '결과 패키징',
          currentIndex: 2,
          totalPackages: 2,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
          packagingDetails: { message: '로컬 저장소 생성 중...' },
        }}
      />
    );
    expect(screen.getByRole('status').textContent).toBe('로컬 저장소 생성 중...');
    expect(screen.getByText('다운로드 진행')).toBeTruthy();
    expect(screen.queryByText('속도')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
