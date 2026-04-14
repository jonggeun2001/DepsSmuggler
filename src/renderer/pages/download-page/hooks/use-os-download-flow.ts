import { message, Modal } from 'antd';
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { buildHistorySettings } from '../../download-delivery-utils';
import {
  buildOSDependencyIssueMessage,
  getOSCartContextSnapshot,
  isOSCartItem,
  persistHistoryAndMaybeClearCart,
  toOSPackageInfo,
} from '../utils';
import type {
  OSPackageInfo,
  OSPackageOutputOptions,
  OSDistribution,
  OSDownloadProgress as OSDownloadProgressData,
} from '../../../../core/downloaders/os-shared/types';
import type { HistoryPackageItem, HistorySettings, HistoryStatus } from '../../../../types';
import type { CartItem } from '../../../stores/cart-store';
import type {
  OSCartContextSnapshot,
  OSDownloadResultData,
} from '../types';

interface UseOSDownloadFlowArgs {
  cartItems: CartItem[];
  outputDir: string;
  includeDependencies: boolean;
  concurrentDownloads: number;
  historyOSOutputOptions?: OSPackageOutputOptions;
  cartSnapshotRef: MutableRefObject<CartItem[]>;
  addHistory: (
    packages: HistoryPackageItem[],
    settings: HistorySettings,
    outputPath: string,
    totalSize: number,
    status: HistoryStatus,
    downloadedCount?: number,
    failedCount?: number
  ) => Promise<string>;
  clearCart: () => void;
  removeCartItem: (id: string) => void;
  checkOutputPath: () => Promise<boolean>;
}

export function useOSDownloadFlow({
  cartItems,
  outputDir,
  includeDependencies,
  concurrentDownloads,
  historyOSOutputOptions,
  cartSnapshotRef,
  addHistory,
  clearCart,
  removeCartItem,
  checkOutputPath,
}: UseOSDownloadFlowArgs) {
  const osCartItems = useMemo(() => cartItems.filter(isOSCartItem), [cartItems]);
  const hasOnlyOSPackages = cartItems.length > 0 && osCartItems.length === cartItems.length;
  const osPackageManagers = useMemo(
    () => Array.from(new Set(osCartItems.map((item) => item.type))),
    [osCartItems]
  );
  const osCartSnapshots = useMemo(
    () => osCartItems.map(getOSCartContextSnapshot),
    [osCartItems]
  );
  const osCartContext = useMemo<OSCartContextSnapshot | null>(() => {
    if (!hasOnlyOSPackages || osPackageManagers.length !== 1) {
      return null;
    }

    const presentSnapshots = osCartSnapshots.filter(
      (snapshot): snapshot is OSCartContextSnapshot => snapshot !== null
    );

    if (presentSnapshots.length !== osCartItems.length || presentSnapshots.length === 0) {
      return null;
    }

    const [firstSnapshot] = presentSnapshots;
    const hasMixedSnapshots = presentSnapshots.some(
      (snapshot) =>
        snapshot.packageManager !== firstSnapshot.packageManager ||
        snapshot.distributionId !== firstSnapshot.distributionId ||
        snapshot.architecture !== firstSnapshot.architecture
    );

    return hasMixedSnapshots ? null : firstSnapshot;
  }, [hasOnlyOSPackages, osCartItems.length, osCartSnapshots, osPackageManagers.length]);

  const [persistedOSContext, setPersistedOSContext] = useState<OSCartContextSnapshot | null>(null);
  const effectiveOSContext = osCartContext ?? persistedOSContext;
  const isDedicatedOSFlow = hasOnlyOSPackages && osCartContext !== null;
  const activeOSPackageManager = effectiveOSContext?.packageManager ?? null;
  const osPackages = useMemo(
    () => osCartItems.map(toOSPackageInfo).filter(Boolean) as OSPackageInfo[],
    [osCartItems]
  );
  const [osDistribution, setOSDistribution] = useState<OSDistribution | null>(null);
  const [osProgress, setOSProgress] = useState<OSDownloadProgressData | null>(null);
  const [osDownloading, setOSDownloading] = useState(false);
  const [osResult, setOSResult] = useState<OSDownloadResultData | null>(null);
  const [osDownloadError, setOSDownloadError] = useState<string | null>(null);
  const shouldRenderDedicatedOSFlow =
    isDedicatedOSFlow || osDownloading || osResult !== null;
  const hasMissingOSCartSnapshots = osCartSnapshots.some((snapshot) => snapshot === null);
  const requiresOSCartReselection =
    hasOnlyOSPackages &&
    osCartItems.length > 0 &&
    hasMissingOSCartSnapshots &&
    !osDownloading &&
    osResult === null;
  const isOSPackaging = osProgress?.phase === 'packaging';

  useEffect(() => {
    if (osCartContext) {
      setPersistedOSContext(osCartContext);
    }
  }, [osCartContext]);

  useEffect(() => {
    if (!shouldRenderDedicatedOSFlow || !effectiveOSContext || !window.electronAPI?.os?.getDistribution) {
      setOSDistribution(null);
      return;
    }

    let active = true;

    window.electronAPI.os.getDistribution(effectiveOSContext.distributionId)
      .then((distribution) => {
        if (active) {
          setOSDistribution((distribution as OSDistribution | undefined) || null);
        }
      })
      .catch((error) => {
        console.error('OS 배포판 정보를 불러오지 못했습니다:', error);
        if (active) {
          setOSDistribution(null);
        }
      });

    return () => {
      active = false;
    };
  }, [effectiveOSContext, shouldRenderDedicatedOSFlow]);

  useEffect(() => {
    if (!isDedicatedOSFlow || !window.electronAPI?.os?.download?.onProgress) {
      setOSProgress(null);
      return;
    }

    return window.electronAPI.os.download.onProgress((progress) => {
      setOSProgress(progress as OSDownloadProgressData);
    });
  }, [isDedicatedOSFlow]);

  const addOSDownloadHistory = useCallback(async (result: OSDownloadResultData) => {
    if (cartSnapshotRef.current.length === 0) {
      return;
    }

    const historyPackages: HistoryPackageItem[] = cartSnapshotRef.current.map((item) => ({
      type: item.type,
      name: item.name,
      version: item.version,
      arch: item.arch,
      languageVersion: item.languageVersion,
      metadata: isOSCartItem(item) && effectiveOSContext
        ? {
            ...item.metadata,
            osContext: {
              distributionId: effectiveOSContext.distributionId,
              architecture: effectiveOSContext.architecture,
              packageManager: effectiveOSContext.packageManager,
            },
          }
        : item.metadata,
    }));

    const historySettings = buildHistorySettings({
      outputFormat: result.outputOptions.archiveFormat || 'zip',
      includeScripts: result.outputOptions.generateScripts,
      includeDependencies,
      deliveryMethod: 'local',
      osOutputOptions: result.outputOptions,
    });

    const failedCount = result.failed.length + result.unresolved.length;
    const downloadedCount = result.success.length;
    let historyStatus: HistoryStatus = 'success';

    if (result.cancelled || failedCount > 0 || result.skipped.length > 0) {
      historyStatus = downloadedCount > 0 ? 'partial' : 'failed';
    }

    const totalSize = result.success.reduce((sum, item) => sum + (item.size || 0), 0);

    await addHistory(
      historyPackages,
      historySettings,
      result.outputPath,
      totalSize,
      historyStatus,
      downloadedCount,
      failedCount
    );
  }, [addHistory, cartSnapshotRef, effectiveOSContext, includeDependencies]);

  const handleStartOSDownload = useCallback(async (outputOptions: OSPackageOutputOptions) => {
    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    if (!activeOSPackageManager || !osDistribution || !effectiveOSContext) {
      message.error('OS 배포판 정보를 아직 불러오지 못했습니다');
      return;
    }

    if (osPackages.length !== osCartItems.length) {
      message.error('장바구니의 OS 패키지 메타데이터가 부족합니다. 다시 검색 후 담아주세요.');
      return;
    }

    const canProceed = await checkOutputPath();
    if (!canProceed) {
      return;
    }

    const osDownloadAPI = window.electronAPI?.os?.download;

    if (!osDownloadAPI?.start) {
      message.error('OS 패키지 다운로드 API를 사용할 수 없습니다');
      return;
    }

    cartSnapshotRef.current = [...osCartItems];
    setPersistedOSContext(effectiveOSContext);
    setOSDownloadError(null);
    setOSResult(null);
    setOSDownloading(true);
    setOSProgress({
      phase: 'resolving',
      currentPackage: '의존성 확인 준비',
      currentIndex: 0,
      totalPackages: osPackages.length,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: 0,
    });

    try {
      const result = await osDownloadAPI.start({
        packages: osPackages,
        outputDir,
        distribution: osDistribution,
        architecture: effectiveOSContext.architecture,
        resolveDependencies: includeDependencies,
        includeOptionalDeps: includeDependencies,
        concurrency: concurrentDownloads,
        outputOptions,
      }) as OSDownloadResultData;

      if (result.unresolved.length > 0) {
        setOSDownloadError(buildOSDependencyIssueMessage(result));
        message.error('해결되지 않은 OS 의존성이 있어 다운로드를 시작하지 않았습니다');
        return;
      }

      let historySaveError: string | null = null;
      const shouldClearCart =
        !result.cancelled && result.failed.length === 0 && result.skipped.length === 0;

      if (!result.cancelled) {
        await persistHistoryAndMaybeClearCart({
          persistHistory: () => addOSDownloadHistory(result),
          clearCart,
          canClearCart: shouldClearCart,
          onPersistError: (error) => {
            console.error('OS download history persistence failed:', error);
            historySaveError = error instanceof Error ? error.message : 'unknown error';
          },
        });
      }
      setOSResult(result);

      if (!result.cancelled) {
        setOSProgress({
          phase: 'packaging',
          currentPackage: '완료',
          currentIndex: result.success.length,
          totalPackages: result.success.length || osPackages.length,
          bytesDownloaded: result.success.length,
          totalBytes: result.success.length || osPackages.length,
          speed: 0,
        });
      }

      if (result.cancelled) {
        message.warning('OS 패키지 다운로드가 취소되었습니다');
      } else if (result.failed.length > 0 || result.skipped.length > 0) {
        message.warning('OS 패키지 다운로드가 부분 완료되었습니다');
      } else {
        message.success('OS 패키지 다운로드가 완료되었습니다');
      }

      if (historySaveError) {
        message.error('다운로드 히스토리 저장에 실패했습니다');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOSDownloadError(errorMessage);
      message.error('OS 패키지 다운로드 중 오류가 발생했습니다');
    } finally {
      setOSDownloading(false);
    }
  }, [
    activeOSPackageManager,
    addOSDownloadHistory,
    cartSnapshotRef,
    checkOutputPath,
    clearCart,
    concurrentDownloads,
    effectiveOSContext,
    includeDependencies,
    osCartItems,
    osDistribution,
    osPackages,
    outputDir,
  ]);

  const handleCancelOSDownload = useCallback(() => {
    if (osProgress?.phase === 'packaging') {
      message.info('패키징 단계에서는 취소할 수 없습니다');
      return;
    }

    Modal.confirm({
      title: 'OS 패키지 다운로드 취소',
      content: '진행 중인 OS 패키지 다운로드를 취소하시겠습니까?',
      okText: '취소',
      okType: 'danger',
      cancelText: '계속',
      onOk: async () => {
        if (!window.electronAPI?.os?.download?.cancel) {
          message.error('OS 패키지 취소 API를 사용할 수 없습니다');
          return;
        }

        await window.electronAPI.os.download.cancel();
        setOSProgress((prev) =>
          prev
            ? {
                ...prev,
                currentPackage: '취소 요청 중',
              }
            : prev
        );
        message.warning('OS 패키지 다운로드 취소를 요청했습니다');
      },
    });
  }, [osProgress?.phase]);

  const handleRemoveOSPackage = useCallback((pkg: OSPackageInfo) => {
    const item = osCartItems.find(
      (cartItem) =>
        cartItem.name === pkg.name &&
        cartItem.version === pkg.version &&
        cartItem.type === activeOSPackageManager
    );
    if (item) {
      removeCartItem(item.id);
    }
  }, [activeOSPackageManager, osCartItems, removeCartItem]);

  const resetOSFlow = useCallback(() => {
    setOSProgress(null);
    setOSResult(null);
    setOSDownloadError(null);
    setOSDownloading(false);
  }, []);

  return {
    osCartItems,
    historyOSOutputOptions,
    isDedicatedOSFlow,
    effectiveOSContext,
    activeOSPackageManager,
    osPackages,
    osDistribution,
    osProgress,
    osDownloading,
    osResult,
    osDownloadError,
    shouldRenderDedicatedOSFlow,
    requiresOSCartReselection,
    isOSPackaging,
    handleStartOSDownload,
    handleCancelOSDownload,
    handleRemoveOSPackage,
    resetOSFlow,
  };
}
