import { describe, expect, it } from 'vitest';
import {
  deriveDownloadPageMode,
  getDownloadCounts,
  hasRecoverableArtifacts,
} from './view-state';
import type { DownloadStoreStatus } from '../../stores/download-store';

function createItem(status: DownloadStoreStatus) {
  return {
    id: `${status}-1`,
    name: 'pkg',
    version: '1.0.0',
    status,
    progress: status === 'completed' ? 100 : 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
  };
}

describe('download-page/view-state', () => {
  it('OS 전용 장바구니는 dedicated OS flow를 우선 렌더링해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 2,
        downloadItemCount: 2,
        packagingStatus: 'idle',
        isDedicatedOSFlow: true,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: false,
        hasRecoverableFailureArtifacts: false,
      })
    ).toBe('os-dedicated');
  });

  it('OS 스냅샷이 누락되면 재선택 화면을 우선 렌더링해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 2,
        downloadItemCount: 0,
        packagingStatus: 'idle',
        isDedicatedOSFlow: false,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: true,
        hasRecoverableFailureArtifacts: false,
      })
    ).toBe('os-reselection');
  });

  it('복구 가능한 실패 산출물이 있으면 failed mode를 반환해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 1,
        downloadItemCount: 1,
        packagingStatus: 'failed',
        isDedicatedOSFlow: false,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: false,
        hasRecoverableFailureArtifacts: true,
      })
    ).toBe('failed');
  });

  it('카트와 다운로드 항목이 모두 비어 있으면 empty mode를 반환해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 0,
        downloadItemCount: 0,
        packagingStatus: 'idle',
        isDedicatedOSFlow: false,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: false,
        hasRecoverableFailureArtifacts: false,
      })
    ).toBe('empty');
  });

  it('완료 산출물이 있으면 카트가 비어도 completed mode를 유지해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 0,
        downloadItemCount: 0,
        packagingStatus: 'completed',
        isDedicatedOSFlow: false,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: false,
        hasRecoverableFailureArtifacts: false,
      })
    ).toBe('completed');
  });

  it('복구 가능한 실패 산출물이 있으면 카트가 비어도 failed mode를 유지해야 함', () => {
    expect(
      deriveDownloadPageMode({
        cartItemCount: 0,
        downloadItemCount: 0,
        packagingStatus: 'failed',
        isDedicatedOSFlow: false,
        osDownloading: false,
        hasOSResult: false,
        requiresOSCartReselection: false,
        hasRecoverableFailureArtifacts: true,
      })
    ).toBe('failed');
  });

  it('다운로드 카운트는 completed/failed/skipped를 분리해야 함', () => {
    expect(
      getDownloadCounts([
        createItem('completed'),
        createItem('failed'),
        createItem('skipped'),
        createItem('downloading'),
      ])
    ).toEqual({
      completedCount: 1,
      failedCount: 1,
      skippedCount: 1,
      allCompleted: false,
    });
  });

  it('복구 가능 산출물 판정은 경로 또는 artifact/error가 있을 때 true여야 함', () => {
    expect(
      hasRecoverableArtifacts({
        completedOutputPath: '',
        completedArtifactPaths: ['/tmp/out.zip'],
        completedDeliveryResult: undefined,
      })
    ).toBe(true);
  });
});
