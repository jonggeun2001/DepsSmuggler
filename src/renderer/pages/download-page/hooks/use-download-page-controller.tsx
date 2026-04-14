import { ExclamationCircleOutlined } from '@ant-design/icons';
import { message, Modal } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCartStore } from '../../../stores/cart-store';
import {
  useDownloadStore,
  type DownloadItem,
  type DownloadStatus,
} from '../../../stores/download-store';
import { useHistoryStore } from '../../../stores/history-store';
import { useSettingsStore } from '../../../stores/settings-store';
import {
  buildDownloadStartOptions,
  buildHistorySettings,
  getEmailDeliveryValidationError,
} from '../../download-delivery-utils';
import {
  createPendingDownloadItems,
  formatBytes,
  hasMatchingActiveCartSnapshot,
  persistHistoryAndMaybeClearCart,
} from '../utils';
import { deriveDownloadPageMode, getDownloadCounts, hasRecoverableArtifacts } from '../view-state';
import { useOSDownloadFlow } from './use-os-download-flow';
import type {
  HistoryDeliveryResult,
  HistoryPackageItem,
  HistorySettings,
  HistoryStatus,
} from '../../../../types';
import type { AllCompleteData, DependencyAPI } from '../../../../types/electron';
import type { CartItem } from '../../../stores/cart-store';
import type { CompletionArtifactsState, HistoryDownloadState } from '../types';

interface DownloadSessionSnapshot {
  id: number;
  cartSnapshot: CartItem[];
  historySettings: HistorySettings;
  trackedItemIds: Set<string>;
}

interface QueuedCompletionEvent {
  data: AllCompleteData;
  sessionSnapshot: DownloadSessionSnapshot | null;
}

interface ProvisionalDownloadSession {
  provisionalSessionId: number;
  previousSessionSnapshot: DownloadSessionSnapshot | null;
  queuedPreviousCompletion: QueuedCompletionEvent | null;
}

export function useDownloadPageController() {
  const location = useLocation();
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const removeCartItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const {
    defaultTargetOS,
    defaultArchitecture,
    includeDependencies,
    languageVersions,
    cudaVersion,
    concurrentDownloads,
    defaultDownloadPath,
    downloadRenderInterval,
    yumDistribution,
    aptDistribution,
    apkDistribution,
    enableFileSplit,
    maxFileSize,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    smtpTo,
    defaultOutputFormat,
    includeInstallScripts,
  } = useSettingsStore();
  const {
    items: downloadItems,
    isDownloading,
    isPaused,
    outputPath,
    packagingStatus,
    packagingProgress,
    logs,
    startTime,
    depsResolved,
    setItems,
    updateItem,
    updateItemsBatch,
    addLogsBatch,
    setIsDownloading,
    setIsPaused,
    setOutputPath,
    setPackagingStatus,
    setPackagingProgress,
    addLog,
    clearLogs,
    setStartTime,
    retryItem,
    setDepsResolved,
    reset,
  } = useDownloadStore();
  const { addHistory } = useHistoryStore();
  const outputFormat = defaultOutputFormat;

  const [outputDir, setOutputDir] = useState(outputPath || defaultDownloadPath || '');
  const [deliveryMethod, setDeliveryMethod] = useState<'local' | 'email'>('local');
  const [completedOutputPath, setCompletedOutputPath] = useState('');
  const [completedArtifactPaths, setCompletedArtifactPaths] = useState<string[]>([]);
  const [completedDeliveryResult, setCompletedDeliveryResult] = useState<HistoryDeliveryResult | undefined>();
  const [completedError, setCompletedError] = useState('');
  const [isResolvingDeps, setIsResolvingDeps] = useState(false);
  const historyDownloadState = (location.state as HistoryDownloadState | null);
  const effectiveSmtpTo = historyDownloadState?.emailRecipient || smtpTo;

  const downloadCancelledRef = useRef(false);
  const downloadPausedRef = useRef(false);
  const cancelledCompletionRetainedRef = useRef(false);
  const dependencyResolutionBypassedRef = useRef(false);
  const previousIncludeDependenciesRef = useRef(includeDependencies);
  const downloadItemsRef = useRef<DownloadItem[]>([]);
  const cartSnapshotRef = useRef<typeof cartItems>([]);
  const historySettingsSnapshotRef = useRef<HistorySettings | null>(null);
  const historyTrackedItemIdsRef = useRef<Set<string> | null>(null);
  const downloadSessionIdRef = useRef(0);
  const activeDownloadSessionRef = useRef<DownloadSessionSnapshot | null>(null);
  const provisionalDownloadSessionRef = useRef<ProvisionalDownloadSession | null>(null);
  const pendingUpdatesRef = useRef<Map<string, Partial<DownloadItem>>>(new Map());
  const pendingLogsRef = useRef<Array<{ level: 'info' | 'warn' | 'error' | 'success'; message: string; details?: string }>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpeedCalcRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });
  const speedHistoryRef = useRef<number[]>([]);

  const completionArtifacts: CompletionArtifactsState = {
    completedOutputPath,
    completedArtifactPaths,
    completedDeliveryResult,
  };

  const createDownloadSessionSnapshot = useCallback((
    cartSnapshot: CartItem[],
    trackedItemIds: Set<string>,
    historySettings: HistorySettings
  ): DownloadSessionSnapshot => {
    const nextSessionId = downloadSessionIdRef.current + 1;
    downloadSessionIdRef.current = nextSessionId;

    const sessionSnapshot: DownloadSessionSnapshot = {
      id: nextSessionId,
      cartSnapshot,
      trackedItemIds,
      historySettings,
    };

    activeDownloadSessionRef.current = sessionSnapshot;
    cartSnapshotRef.current = cartSnapshot;
    historyTrackedItemIdsRef.current = trackedItemIds;
    historySettingsSnapshotRef.current = historySettings;

    return sessionSnapshot;
  }, []);

  const checkOutputPath = useCallback(async (): Promise<boolean> => {
    try {
      if (!window.electronAPI?.download?.checkPath) {
        throw new Error('출력 폴더 검사 API를 사용할 수 없습니다');
      }

      const data = await window.electronAPI.download.checkPath(outputDir);

      if (!data.exists || data.fileCount === 0) {
        return true;
      }

      const prettyBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      };

      return new Promise((resolve) => {
        Modal.confirm({
          title: '기존 데이터 발견',
          icon: <ExclamationCircleOutlined />,
          content: (
            <div>
              <p>출력 폴더에 기존 데이터가 있습니다:</p>
              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                <li>파일 수: <strong>{data.fileCount}개</strong></li>
                <li>총 크기: <strong>{prettyBytes(data.totalSize || 0)}</strong></li>
              </ul>
              <p style={{ marginTop: 12, color: '#ff4d4f' }}>
                기존 데이터를 삭제하고 새로 다운로드하시겠습니까?
              </p>
            </div>
          ),
          okText: '삭제 후 진행',
          okType: 'danger',
          cancelText: '취소',
          onOk: async () => {
            if (!window.electronAPI?.download?.clearPath) {
              message.error('폴더 삭제 API를 사용할 수 없습니다');
              resolve(false);
              return;
            }
            const clearResult = await window.electronAPI.download.clearPath(outputDir);
            if (clearResult.success) {
              message.success('기존 데이터 삭제 완료');
              addLog('info', '기존 데이터 삭제', outputDir);
              resolve(true);
            } else {
              message.error('데이터 삭제 실패');
              resolve(false);
            }
          },
          onCancel: () => resolve(false),
        });
      });
    } catch (error) {
      console.error('폴더 검사 실패:', error);
      return true;
    }
  }, [addLog, outputDir]);

  const osFlow = useOSDownloadFlow({
    cartItems,
    outputDir,
    includeDependencies,
    concurrentDownloads,
    historyOSOutputOptions: historyDownloadState?.osOutputOptions,
    cartSnapshotRef,
    addHistory,
    clearCart,
    removeCartItem,
    checkOutputPath,
  });

  useEffect(() => {
    if (cartItems.length > 0 && downloadItems.length === 0) {
      const items = createPendingDownloadItems(cartItems);
      setItems(items);
      clearLogs();
    }
  }, [cartItems, clearLogs, downloadItems.length, setItems]);

  useEffect(() => {
    const restoredDeliveryMethod = historyDownloadState?.deliveryMethod;

    if (restoredDeliveryMethod) {
      setDeliveryMethod(restoredDeliveryMethod);
    }
  }, [historyDownloadState]);

  useEffect(() => {
    const includeDependenciesChanged =
      previousIncludeDependenciesRef.current !== includeDependencies;
    previousIncludeDependenciesRef.current = includeDependencies;
    const currentOriginalIds = new Set(
      downloadItems.filter((item) => !item.isDependency).map((item) => item.id)
    );
    const hasSameCartAsQueue =
      cartItems.length === currentOriginalIds.size &&
      cartItems.every((item) => currentOriginalIds.has(item.id));
    const hasCompletedQueue =
      downloadItems.length > 0 &&
      downloadItems.every((item) => ['completed', 'skipped'].includes(item.status));

    if (isDownloading) {
      return;
    }

    if (cartItems.length === 0) {
      if (downloadItems.length > 0 && !hasCompletedQueue) {
        setItems([]);
        downloadItemsRef.current = [];
        setDepsResolved(false);
        dependencyResolutionBypassedRef.current = false;
      }
      return;
    }

    if (!includeDependencies) {
      if (!includeDependenciesChanged && downloadItems.length > 0 && hasSameCartAsQueue) {
        return;
      }

      const items = createPendingDownloadItems(cartItems);
      setItems(items);
      downloadItemsRef.current = items;
      setDepsResolved(true);
      dependencyResolutionBypassedRef.current = true;
      return;
    }

    if (dependencyResolutionBypassedRef.current && includeDependenciesChanged) {
      const items = createPendingDownloadItems(cartItems);
      setItems(items);
      downloadItemsRef.current = items;
      setDepsResolved(false);
      dependencyResolutionBypassedRef.current = false;
    }
  }, [cartItems, downloadItems, includeDependencies, isDownloading, setDepsResolved, setItems]);

  const persistHistoryEntry = useCallback(async (
    data: AllCompleteData,
    forcedStatus?: HistoryStatus,
    sessionSnapshot?: DownloadSessionSnapshot | null
  ) => {
    const finalItems = useDownloadStore.getState().items;
    const effectiveSessionSnapshot = sessionSnapshot ?? activeDownloadSessionRef.current;
    const trackedItemIds = effectiveSessionSnapshot?.trackedItemIds ?? historyTrackedItemIdsRef.current;
    const relevantItems = trackedItemIds && trackedItemIds.size > 0
      ? finalItems.filter((item) => trackedItemIds.has(item.id))
      : finalItems;

    const historyPackages: HistoryPackageItem[] = (
      effectiveSessionSnapshot?.cartSnapshot ?? cartSnapshotRef.current
    ).map((item) => ({
      type: item.type,
      name: item.name,
      version: item.version,
      arch: item.arch,
      languageVersion: item.languageVersion,
      metadata: item.metadata,
    }));

    const historySettings = effectiveSessionSnapshot?.historySettings ?? historySettingsSnapshotRef.current ?? buildHistorySettings({
      outputFormat,
      includeScripts: includeInstallScripts,
      includeDependencies,
      deliveryMethod,
      smtpTo: effectiveSmtpTo,
      fileSplitEnabled: enableFileSplit,
      maxFileSizeMB: maxFileSize,
    });

    const resultMap = new Map((data.results || []).map((result) => [result.id, result.success]));
    let completedCount = 0;
    let failedCount = 0;

    relevantItems.forEach((item) => {
      const result = resultMap.get(item.id);
      if (typeof result === 'boolean') {
        if (result) {
          completedCount += 1;
        } else {
          failedCount += 1;
        }
        return;
      }

      if (item.status === 'completed') {
        completedCount += 1;
      } else if (item.status === 'failed') {
        failedCount += 1;
      }
    });

    const totalCount = relevantItems.length || data.results?.length || 0;
    let historyStatus = forcedStatus || 'success';

    if (!forcedStatus) {
      if (failedCount === totalCount && totalCount > 0) {
        historyStatus = 'failed';
      } else if (failedCount > 0) {
        historyStatus = 'partial';
      }
    }

    const totalSize = relevantItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);

    await addHistory(
      historyPackages,
      historySettings,
      data.outputPath,
      totalSize,
      historyStatus,
      completedCount,
      failedCount,
      {
        artifactPaths: data.artifactPaths,
        deliveryMethod: data.deliveryMethod || historySettings.deliveryMethod,
        deliveryResult: data.deliveryResult,
      }
    );
  }, [
    addHistory,
    deliveryMethod,
    effectiveSmtpTo,
    enableFileSplit,
    includeDependencies,
    includeInstallScripts,
    maxFileSize,
    outputFormat,
  ]);

  const beginProvisionalDownloadSession = useCallback((
    sessionSnapshot: DownloadSessionSnapshot,
    previousSessionSnapshot: DownloadSessionSnapshot | null
  ) => {
    provisionalDownloadSessionRef.current = {
      provisionalSessionId: sessionSnapshot.id,
      previousSessionSnapshot,
      queuedPreviousCompletion: null,
    };
  }, []);

  const queuePreviousCompletionDuringProvisionalSession = useCallback((data: AllCompleteData) => {
    const provisionalSession = provisionalDownloadSessionRef.current;
    if (!provisionalSession || typeof data.sessionId !== 'number') {
      return false;
    }

    if (data.sessionId !== provisionalSession.previousSessionSnapshot?.id) {
      return false;
    }

    provisionalSession.queuedPreviousCompletion = {
      data,
      sessionSnapshot: provisionalSession.previousSessionSnapshot,
    };
    return true;
  }, []);

  const clearProvisionalDownloadSession = useCallback((sessionId: number) => {
    if (provisionalDownloadSessionRef.current?.provisionalSessionId === sessionId) {
      provisionalDownloadSessionRef.current = null;
    }
  }, []);

  const takeQueuedPreviousCompletion = useCallback((sessionId: number): QueuedCompletionEvent | null => {
    if (provisionalDownloadSessionRef.current?.provisionalSessionId !== sessionId) {
      return null;
    }

    const queuedPreviousCompletion = provisionalDownloadSessionRef.current.queuedPreviousCompletion;
    provisionalDownloadSessionRef.current = null;
    return queuedPreviousCompletion;
  }, []);

  const applyDownloadCompletion = useCallback((
    data: AllCompleteData,
    completionSessionSnapshot: DownloadSessionSnapshot | null,
    handlers: {
      updatePackage: (packageId: string, update: Partial<DownloadItem>) => void;
      logMessage: (
        level: 'info' | 'warn' | 'error' | 'success',
        messageText: string,
        details?: string
      ) => void;
    }
  ) => {
    const { updatePackage, logMessage } = handlers;

    if (downloadCancelledRef.current && !data.cancelled) {
      return;
    }

    if (!data.success) {
      setIsDownloading(false);
      setIsPaused(false);

      if (data.cancelled) {
        const hasRecoverableCancelledOutcome =
          Boolean(data.deliveryResult?.emailSent)
          || Boolean(data.deliveryResult?.error)
          || Boolean(data.artifactPaths && data.artifactPaths.length > 0)
          || Boolean(data.outputPath && data.outputPath !== outputDir);

        if (hasRecoverableCancelledOutcome) {
          const cancelledDeliveryMessage = data.deliveryResult?.emailSent
            ? '다운로드는 취소되었지만 이메일 전달은 이미 완료되었습니다.'
            : data.deliveryResult?.error
            || '다운로드는 취소되었지만 생성된 산출물과 전달 정보를 확인할 수 있습니다.';
          const cancelledDeliveryTitle = data.deliveryResult?.emailSent
            ? '취소 후 이메일 전달 완료'
            : '취소 후 전달 정보 보존';
          cancelledCompletionRetainedRef.current = true;
          setPackagingStatus('failed');
          setPackagingProgress(100);
          setCompletedOutputPath(data.outputPath || '');
          setCompletedArtifactPaths(
            data.artifactPaths && data.artifactPaths.length > 0
              ? data.artifactPaths
              : data.outputPath && data.outputPath !== outputDir
              ? [data.outputPath]
              : []
          );
          setCompletedDeliveryResult(data.deliveryResult);
          setCompletedError(cancelledDeliveryMessage);
          logMessage('warn', cancelledDeliveryTitle, cancelledDeliveryMessage);
          message.warning(cancelledDeliveryMessage);
          const forcedHistoryStatus = data.deliveryResult?.emailSent
            ? undefined
            : (data.results || []).some((result) => !result.success)
            ? 'partial'
            : 'failed';
          void persistHistoryEntry(data, forcedHistoryStatus, completionSessionSnapshot).catch((error) => {
            const historyError = error instanceof Error ? error.message : 'unknown error';
            logMessage('error', '히스토리 저장 실패', historyError);
            message.error('히스토리 저장에 실패했습니다.');
          });
          return;
        }

        cancelledCompletionRetainedRef.current = false;
        setPackagingStatus('idle');
        setPackagingProgress(0);
        setCompletedOutputPath('');
        setCompletedArtifactPaths([]);
        setCompletedDeliveryResult(undefined);
        setCompletedError('');
        return;
      }

      setPackagingStatus('failed');
      setPackagingProgress(0);
      setCompletedOutputPath(data.outputPath || '');
      setCompletedArtifactPaths(data.artifactPaths || []);
      setCompletedDeliveryResult(data.deliveryResult);
      setCompletedError(data.error || data.deliveryResult?.error || '');

      const errorMessage = data.error || '패키징 중 오류가 발생했습니다';
      logMessage('error', '다운로드/패키징 실패', errorMessage);
      message.error(errorMessage);
      void persistHistoryEntry(data, 'failed', completionSessionSnapshot).catch((error) => {
        const historyError = error instanceof Error ? error.message : 'unknown error';
        logMessage('error', '히스토리 저장 실패', historyError);
        message.error('히스토리 저장에 실패했습니다.');
      });
      return;
    }

    const currentItems = useDownloadStore.getState().items;
    currentItems.forEach((item) => {
      if (item.status === 'downloading' || item.status === 'pending') {
        updatePackage(item.id, { status: 'completed', progress: 100 });
      }
    });

    setIsDownloading(false);
    setPackagingStatus('completed');
    setPackagingProgress(100);
    setCompletedOutputPath(data.outputPath);
    setCompletedArtifactPaths(data.artifactPaths || [data.outputPath]);
    setCompletedDeliveryResult(data.deliveryResult);
    setCompletedError('');
    const completionMessage = data.deliveryMethod === 'email'
      ? '다운로드, 패키징 및 이메일 전달이 완료되었습니다'
      : '다운로드 및 패키징이 완료되었습니다';
    logMessage('success', '다운로드 및 패키징 완료', `다운로드 경로: ${data.outputPath}`);
    message.success(completionMessage);
    const failedCount = (data.results || []).filter((result) => !result.success).length
      || useDownloadStore.getState().items.filter((item) => item.status === 'failed').length;
    void persistHistoryAndMaybeClearCart({
      persistHistory: () => persistHistoryEntry(data, undefined, completionSessionSnapshot),
      clearCart,
      canClearCart: () =>
        failedCount === 0
        && hasMatchingActiveCartSnapshot({
          snapshot: completionSessionSnapshot?.cartSnapshot ?? [],
          currentItems: useCartStore.getState().items,
          expectedSessionId: completionSessionSnapshot?.id ?? null,
          activeSessionId: activeDownloadSessionRef.current?.id ?? null,
        }),
      onPersistError: (error) => {
        const historyError = error instanceof Error ? error.message : 'unknown error';
        logMessage('error', '히스토리 저장 실패', historyError);
        message.error('히스토리 저장에 실패했습니다.');
      },
    });
  }, [
    clearCart,
    outputDir,
    persistHistoryEntry,
    setIsDownloading,
    setIsPaused,
    setPackagingProgress,
    setPackagingStatus,
  ]);

  useEffect(() => {
    if (!window.electronAPI?.download) return;
    const pendingUpdates = pendingUpdatesRef.current;
    const pendingLogs = pendingLogsRef;

    const flushPendingUpdates = () => {
      const queuedLogs = pendingLogs.current;

      if (pendingUpdates.size > 0) {
        updateItemsBatch(new Map(pendingUpdates));
        pendingUpdates.clear();
      }

      if (queuedLogs.length > 0) {
        addLogsBatch([...queuedLogs]);
        pendingLogs.current = [];
      }

      batchTimerRef.current = null;
    };

    const scheduleBatchUpdate = (packageId: string, update: Partial<DownloadItem>) => {
      pendingUpdatesRef.current.set(packageId, update);
      if (batchTimerRef.current === null) {
        batchTimerRef.current = setTimeout(flushPendingUpdates, downloadRenderInterval);
      }
    };

    const scheduleLogBatch = (
      level: 'info' | 'warn' | 'error' | 'success',
      messageText: string,
      details?: string
    ) => {
      pendingLogs.current.push({ level, message: messageText, details });
      if (batchTimerRef.current === null) {
        batchTimerRef.current = setTimeout(flushPendingUpdates, downloadRenderInterval);
      }
    };

    const formatSize = (bytes: number) => {
      if (!bytes || bytes === 0) return '';
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
      if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${bytes} B`;
    };

    const isStaleSessionEvent = (sessionId?: number) => {
      if (typeof sessionId !== 'number') {
        return false;
      }

      return sessionId !== activeDownloadSessionRef.current?.id;
    };

    const unsubProgress = window.electronAPI.download.onProgress((progress) => {
      const p = progress;

      if (isStaleSessionEvent(p.sessionId) || downloadCancelledRef.current) {
        return;
      }

      if (p.status === 'completed') {
        scheduleBatchUpdate(p.packageId, {
          status: 'completed',
          progress: 100,
          downloadedBytes: p.totalBytes,
          totalBytes: p.totalBytes,
        });
        const completedItem = downloadItemsRef.current.find((item) => item.id === p.packageId);
        const displayName = completedItem
          ? `${completedItem.name} (v${completedItem.version})`
          : p.packageId;
        const sizeStr = p.totalBytes ? formatSize(p.totalBytes) : '';
        scheduleLogBatch('success', `다운로드 완료: ${displayName}`, sizeStr || undefined);
      } else if (p.status === 'failed') {
        scheduleBatchUpdate(p.packageId, {
          status: 'failed',
          error: p.error,
        });
        const item = downloadItemsRef.current.find((downloadItem) => downloadItem.id === p.packageId);
        if (item) {
          scheduleLogBatch('error', `다운로드 실패: ${item.name} (v${item.version})`, p.error);
        }
      } else {
        scheduleBatchUpdate(p.packageId, {
          status: p.status as 'downloading' | 'paused',
          progress: p.progress,
          downloadedBytes: p.downloadedBytes,
          totalBytes: p.totalBytes,
          speed: p.speed || 0,
        });
      }
    });

    const unsubStatus = window.electronAPI.download.onStatus?.((status) => {
      if (isStaleSessionEvent(status.sessionId) || downloadCancelledRef.current) {
        return;
      }

      if (status.phase === 'resolving') {
        scheduleLogBatch('info', '의존성 분석 중...');
      } else if (status.phase === 'downloading') {
        scheduleLogBatch('info', '다운로드 시작...');
      }
    });

    const unsubDepsResolved = window.electronAPI.download.onDepsResolved?.((data) => {
      interface DependencyNodeData {
        package: { name: string; version: string; type?: string };
        dependencies: DependencyNodeData[];
      }
      interface DependencyTreeData {
        root: DependencyNodeData;
      }

      const originalPackages = data.originalPackages as Array<{ id: string; name: string; version: string; type: string; filename?: string }>;
      const allPackages = data.allPackages as Array<{ id: string; name: string; version: string; type: string; filename?: string }>;
      const dependencyTrees = data.dependencyTrees as DependencyTreeData[] | undefined;
      const failedPackages = data.failedPackages as Array<{ name: string; version: string; error: string }> | undefined;

      scheduleLogBatch(
        'info',
        `의존성 해결 완료: ${originalPackages.length}개 → ${allPackages.length}개 패키지`
      );

      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalIds = new Set(originalPackages.map((pkg) => pkg.id));

      if (dependencyTrees) {
        dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          const rootId = `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;
          const stack: DependencyNodeData[] = [tree.root];
          const visited = new Set<string>();

          while (stack.length > 0) {
            const node = stack.pop();
            if (!node) {
              continue;
            }
            const nodeId = `${node.package.type || 'pip'}-${node.package.name}-${node.package.version}`;

            if (visited.has(nodeId)) {
              continue;
            }
            visited.add(nodeId);

            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depId = `${depPkg.type || 'pip'}-${depPkg.name}-${depPkg.version}`;

              if (!originalIds.has(depId)) {
                dependencyMap.set(depId, { parentId: rootId, parentName: rootName });
              }

              if (!visited.has(depId)) {
                stack.push(dep);
              }
            });
          }
        });
      }

      const newItems: DownloadItem[] = allPackages.map((pkg) => {
        const depInfo = dependencyMap.get(pkg.id);
        const isOriginal = originalIds.has(pkg.id);

        return {
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          type: pkg.type,
          status: 'pending' as DownloadStatus,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          speed: 0,
          isDependency: !isOriginal,
          parentId: depInfo?.parentId,
          dependencyOf: depInfo?.parentName,
          filename: pkg.filename,
        };
      });
      setItems(newItems);
      downloadItemsRef.current = newItems;

      if (failedPackages && failedPackages.length > 0) {
        failedPackages.forEach((failed) => {
          scheduleLogBatch('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }
    });

    const unsubAllComplete = window.electronAPI.download.onAllComplete?.((data) => {
      if (isStaleSessionEvent(data.sessionId)) {
        queuePreviousCompletionDuringProvisionalSession(data);
        return;
      }

      applyDownloadCompletion(data, activeDownloadSessionRef.current, {
        updatePackage: scheduleBatchUpdate,
        logMessage: scheduleLogBatch,
      });
    });

    return () => {
      unsubProgress();
      unsubStatus?.();
      unsubDepsResolved?.();
      unsubAllComplete?.();
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      pendingUpdates.clear();
      pendingLogs.current = [];
    };
  }, [
    addLogsBatch,
    applyDownloadCompletion,
    downloadRenderInterval,
    queuePreviousCompletionDuringProvisionalSession,
    setItems,
    updateItemsBatch,
  ]);

  useEffect(() => {
    downloadItemsRef.current = downloadItems;
  }, [downloadItems]);

  const handleSelectFolder = useCallback(async () => {
    if (window.electronAPI?.selectFolder) {
      const result = await window.electronAPI.selectFolder();
      if (result) {
        setOutputDir(result);
        setOutputPath(result);
        addLog('info', `출력 폴더 선택: ${result}`);
      }
      return;
    }

    const devOutputPath = './depssmuggler-downloads';
    setOutputDir(devOutputPath);
    setOutputPath(devOutputPath);
    message.warning('브라우저 환경에서는 폴더 선택이 불가능합니다. 개발 서버의 기본 경로를 사용합니다.');
    addLog('info', `개발 환경 다운로드 경로: ${devOutputPath}`);
  }, [addLog, setOutputPath]);

  const calculateOverallSpeed = useCallback((): number => {
    if (!isDownloading || !startTime) return 0;

    const now = Date.now();
    const totalDownloaded = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);
    const lastCalc = lastSpeedCalcRef.current;
    const timeDiff = now - lastCalc.time;

    if (timeDiff >= 500 && lastCalc.time > 0) {
      const bytesDiff = totalDownloaded - lastCalc.bytes;
      const instantSpeed = bytesDiff > 0 ? (bytesDiff / timeDiff) * 1000 : 0;

      if (instantSpeed > 0) {
        speedHistoryRef.current.push(instantSpeed);
        if (speedHistoryRef.current.length > 10) {
          speedHistoryRef.current.shift();
        }
      }

      lastSpeedCalcRef.current = { time: now, bytes: totalDownloaded };
    } else if (lastCalc.time === 0 && totalDownloaded > 0) {
      lastSpeedCalcRef.current = { time: now, bytes: totalDownloaded };
    }

    if (speedHistoryRef.current.length === 0) {
      const elapsed = now - startTime;
      return elapsed > 0 ? (totalDownloaded / elapsed) * 1000 : 0;
    }

    let weightedSum = 0;
    let weightSum = 0;
    speedHistoryRef.current.forEach((speed, index) => {
      const weight = index + 1;
      weightedSum += speed * weight;
      weightSum += weight;
    });

    return weightSum > 0 ? weightedSum / weightSum : 0;
  }, [downloadItems, isDownloading, startTime]);

  const calculateRemainingTime = useCallback(() => {
    if (!isDownloading) return null;

    const overallSpeed = calculateOverallSpeed();
    if (overallSpeed <= 0) return null;

    const downloadedBytes = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);
    const expectedBytes = downloadItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
    const remainingBytes = expectedBytes - downloadedBytes;

    if (remainingBytes <= 0) return null;

    const remainingMs = (remainingBytes / overallSpeed) * 1000;

    if (remainingMs < 60000) {
      return `${Math.ceil(remainingMs / 1000)}초`;
    }
    if (remainingMs < 3600000) {
      return `${Math.ceil(remainingMs / 60000)}분`;
    }

    return `${Math.floor(remainingMs / 3600000)}시간 ${Math.ceil((remainingMs % 3600000) / 60000)}분`;
  }, [calculateOverallSpeed, downloadItems, isDownloading]);

  const handleResolveDependencies = useCallback(async () => {
    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    if (!includeDependencies) {
      const items = createPendingDownloadItems(cartItems);
      setItems(items);
      downloadItemsRef.current = items;
      setDepsResolved(true);
      dependencyResolutionBypassedRef.current = true;
      addLog('info', '의존성 자동 포함이 꺼져 있어 원본 패키지만 다운로드합니다');
      return;
    }

    setIsResolvingDeps(true);
    setDepsResolved(false);
    dependencyResolutionBypassedRef.current = false;
    addLog('info', '의존성 확인 시작', `${cartItems.length}개 패키지`);

    const dependencyAPI = window.electronAPI?.dependency as DependencyAPI | undefined;
    let unsubscribe: (() => void) | undefined;

    if (dependencyAPI?.onProgress) {
      unsubscribe = dependencyAPI.onProgress((progress) => {
        if (progress.status === 'start') {
          addLog('info', `[${progress.current}/${progress.total}] 의존성 확인 중: ${progress.packageType}/${progress.packageName}`);
        } else if (progress.status === 'success') {
          addLog('info', `[${progress.current}/${progress.total}] 완료: ${progress.packageName} (${progress.dependencyCount}개 의존성)`);
        } else if (progress.status === 'error') {
          addLog('error', `[${progress.current}/${progress.total}] 실패: ${progress.packageName}`, progress.error);
        }
      });
    }

    try {
      const packages = cartItems.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
        downloadUrl: item.downloadUrl,
        repository: item.repository,
        location: item.location,
        metadata: item.metadata,
        indexUrl: item.indexUrl,
        extras: item.extras,
        classifier: item.classifier,
      }));

      const options = {
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies,
        pythonVersion: languageVersions.python,
        cudaVersion,
        yumDistribution,
        aptDistribution,
        apkDistribution,
      };

      if (!dependencyAPI?.resolve) {
        throw new Error('의존성 해결 API를 사용할 수 없습니다');
      }

      const data = await dependencyAPI.resolve({ packages, options }) as {
        originalPackages: Array<{ id: string; name: string; version: string; type: string; size?: number; downloadUrl?: string; filename?: string; metadata?: Record<string, unknown>; classifier?: string }>;
        allPackages: Array<{ id: string; name: string; version: string; type: string; size?: number; downloadUrl?: string; filename?: string; metadata?: Record<string, unknown>; classifier?: string }>;
        dependencyTrees: Array<{
          root: {
            package: { name: string; version: string; type?: string };
            dependencies: Array<unknown>;
          };
        }>;
        failedPackages: Array<{ name: string; version: string; error: string }>;
      };

      addLog('info', `의존성 해결 완료: ${data.originalPackages.length}개 → ${data.allPackages.length}개 패키지`);

      interface DependencyNodeData {
        package: { name: string; version: string; type?: string };
        dependencies: DependencyNodeData[];
      }

      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalNames = new Set(data.originalPackages.map((pkg) => `${pkg.name}-${pkg.version}`));
      const originalIdByName = new Map<string, string>();
      data.originalPackages.forEach((pkg) => {
        originalIdByName.set(pkg.name, pkg.id);
      });

      if (data.dependencyTrees) {
        data.dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          const rootId = originalIdByName.get(rootPkg.name) || `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;
          const stack: DependencyNodeData[] = [tree.root as DependencyNodeData];
          const visited = new Set<string>();

          while (stack.length > 0) {
            const node = stack.pop();
            if (!node) {
              continue;
            }
            const nodeKey = `${node.package.name}-${node.package.version}`;

            if (visited.has(nodeKey)) {
              continue;
            }
            visited.add(nodeKey);

            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depKey = `${depPkg.name}-${depPkg.version}`;

              if (!originalNames.has(depKey)) {
                dependencyMap.set(depKey, { parentId: rootId, parentName: rootName });
              }

              if (!visited.has(depKey)) {
                stack.push(dep);
              }
            });
          }
        });
      }

      const newItems: DownloadItem[] = data.allPackages.map((pkg) => {
        const pkgKey = `${pkg.name}-${pkg.version}`;
        const depInfo = dependencyMap.get(pkgKey);
        const isOriginal = originalNames.has(pkgKey);

        return {
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          type: pkg.type,
          status: 'pending' as DownloadStatus,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: pkg.size || 0,
          speed: 0,
          isDependency: !isOriginal,
          parentId: depInfo?.parentId,
          dependencyOf: depInfo?.parentName,
          downloadUrl: pkg.downloadUrl,
          filename: pkg.filename,
          metadata: pkg.metadata,
          classifier: pkg.classifier,
        };
      });

      setItems(newItems);
      downloadItemsRef.current = newItems;
      addLog('info', `총 다운로드 크기: ${formatBytes(newItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0))}`);

      if (data.failedPackages && data.failedPackages.length > 0) {
        data.failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }

      setDepsResolved(true);
      dependencyResolutionBypassedRef.current = false;
      message.success(`의존성 확인 완료: ${data.allPackages.length}개 패키지 (${formatBytes(newItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0))})`);
    } catch (error) {
      addLog('error', '의존성 확인 실패', String(error));
      message.error('의존성 확인 중 오류가 발생했습니다');
    } finally {
      unsubscribe?.();
      setIsResolvingDeps(false);
    }
  }, [
    addLog,
    apkDistribution,
    aptDistribution,
    cartItems,
    cudaVersion,
    defaultArchitecture,
    defaultTargetOS,
    includeDependencies,
    languageVersions.python,
    outputDir,
    setDepsResolved,
    setItems,
    yumDistribution,
  ]);

  const handleStartDownload = useCallback(async () => {
    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    const emailDeliveryValidationError = getEmailDeliveryValidationError({
      deliveryMethod,
      smtpHost,
      smtpPort,
      smtpTo: effectiveSmtpTo,
      smtpFrom,
      smtpUser,
    });

    if (emailDeliveryValidationError) {
      message.warning(emailDeliveryValidationError);
      return;
    }

    if (includeDependencies && !depsResolved) {
      message.warning('먼저 의존성 확인을 진행하세요');
      return;
    }

    setIsDownloading(true);
    setIsPaused(false);
    setStartTime(Date.now());
    const previousSessionState = {
      sessionCounter: downloadSessionIdRef.current,
      activeSession: activeDownloadSessionRef.current,
      cartSnapshot: cartSnapshotRef.current,
      historyTrackedItemIds: historyTrackedItemIdsRef.current,
      historySettings: historySettingsSnapshotRef.current,
      downloadCancelled: downloadCancelledRef.current,
      downloadPaused: downloadPausedRef.current,
      cancelledCompletionRetained: cancelledCompletionRetainedRef.current,
      lastSpeedCalc: lastSpeedCalcRef.current,
      speedHistory: [...speedHistoryRef.current],
      startTime,
      isDownloading,
      isPaused,
      packagingStatus,
      packagingProgress,
      completedOutputPath,
      completedArtifactPaths: [...completedArtifactPaths],
      completedDeliveryResult,
      completedError,
    };
    const sessionSnapshot = createDownloadSessionSnapshot(
      [...cartItems],
      new Set(downloadItems.map((item) => item.id)),
      buildHistorySettings({
        outputFormat,
        includeScripts: includeInstallScripts,
        includeDependencies,
        deliveryMethod,
        smtpTo: effectiveSmtpTo,
        fileSplitEnabled: enableFileSplit,
        maxFileSizeMB: maxFileSize,
      })
    );
    beginProvisionalDownloadSession(sessionSnapshot, previousSessionState.activeSession);
    downloadCancelledRef.current = false;
    downloadPausedRef.current = false;
    cancelledCompletionRetainedRef.current = false;
    lastSpeedCalcRef.current = { time: 0, bytes: 0 };
    speedHistoryRef.current = [];

    const restorePreviousSessionState = () => {
      downloadSessionIdRef.current = previousSessionState.sessionCounter;
      activeDownloadSessionRef.current = previousSessionState.activeSession;
      cartSnapshotRef.current = previousSessionState.cartSnapshot;
      historyTrackedItemIdsRef.current = previousSessionState.historyTrackedItemIds;
      historySettingsSnapshotRef.current = previousSessionState.historySettings;
      downloadCancelledRef.current = previousSessionState.downloadCancelled;
      downloadPausedRef.current = previousSessionState.downloadPaused;
      cancelledCompletionRetainedRef.current = previousSessionState.cancelledCompletionRetained;
      lastSpeedCalcRef.current = previousSessionState.lastSpeedCalc;
      speedHistoryRef.current = [...previousSessionState.speedHistory];
      setStartTime(previousSessionState.startTime);
      setIsDownloading(previousSessionState.isDownloading);
      setIsPaused(previousSessionState.isPaused);
      setPackagingStatus(previousSessionState.packagingStatus);
      setPackagingProgress(previousSessionState.packagingProgress);
      setCompletedOutputPath(previousSessionState.completedOutputPath);
      setCompletedArtifactPaths([...previousSessionState.completedArtifactPaths]);
      setCompletedDeliveryResult(previousSessionState.completedDeliveryResult);
      setCompletedError(previousSessionState.completedError);

      const queuedPreviousCompletion = takeQueuedPreviousCompletion(sessionSnapshot.id);
      if (queuedPreviousCompletion) {
        applyDownloadCompletion(queuedPreviousCompletion.data, queuedPreviousCompletion.sessionSnapshot, {
          updatePackage: updateItem,
          logMessage: addLog,
        });
      }
    };

    const canProceed = await checkOutputPath();
    if (!canProceed) {
      restorePreviousSessionState();
      return;
    }
    setCompletedOutputPath('');
    setCompletedArtifactPaths([]);
    setCompletedDeliveryResult(undefined);
    setCompletedError('');

    addLog('info', '다운로드 시작', `총 ${downloadItems.length}개 패키지`);

    if (!window.electronAPI?.download?.start) {
      restorePreviousSessionState();
      addLog('error', '다운로드 API를 사용할 수 없습니다');
      return;
    }

    try {
      const packages = downloadItems.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
        downloadUrl: item.downloadUrl,
        metadata: item.metadata,
        repository: item.repository,
        location: item.location,
        indexUrl: item.indexUrl,
        extras: item.extras,
        classifier: item.classifier,
      }));

      const options = buildDownloadStartOptions({
        outputDir,
        outputFormat,
        includeScripts: includeInstallScripts,
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies,
        pythonVersion: languageVersions.python,
        concurrency: concurrentDownloads,
        deliveryMethod,
        smtpTo: effectiveSmtpTo,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPassword,
        smtpFrom,
        fileSplitEnabled: enableFileSplit,
        maxFileSizeMB: maxFileSize,
      });

      await window.electronAPI.download.start({
        sessionId: sessionSnapshot.id,
        packages,
        options,
      });
      clearProvisionalDownloadSession(sessionSnapshot.id);
    } catch (error) {
      restorePreviousSessionState();
      addLog('error', '다운로드 시작 실패', String(error));
    }
  }, [
    addLog,
    applyDownloadCompletion,
    beginProvisionalDownloadSession,
    cartItems,
    checkOutputPath,
    clearProvisionalDownloadSession,
    completedArtifactPaths,
    completedDeliveryResult,
    completedError,
    completedOutputPath,
    concurrentDownloads,
    createDownloadSessionSnapshot,
    defaultArchitecture,
    defaultTargetOS,
    deliveryMethod,
    depsResolved,
    downloadItems,
    effectiveSmtpTo,
    enableFileSplit,
    includeDependencies,
    includeInstallScripts,
    isDownloading,
    isPaused,
    languageVersions.python,
    maxFileSize,
    outputDir,
    outputFormat,
    packagingProgress,
    packagingStatus,
    startTime,
    setIsDownloading,
    setIsPaused,
    setPackagingProgress,
    setPackagingStatus,
    setStartTime,
    smtpFrom,
    smtpHost,
    smtpPassword,
    smtpPort,
    smtpUser,
    takeQueuedPreviousCompletion,
    updateItem,
  ]);

  const handlePauseResume = useCallback(async () => {
    if (isPaused) {
      downloadPausedRef.current = false;
      setIsPaused(false);
      if (window.electronAPI?.download?.resume) {
        await window.electronAPI.download.resume();
      }
      addLog('info', '다운로드 재개');
    } else {
      downloadPausedRef.current = true;
      setIsPaused(true);
      if (window.electronAPI?.download?.pause) {
        await window.electronAPI.download.pause();
      }
      addLog('info', '다운로드 일시정지');
    }
  }, [addLog, isPaused, setIsPaused]);

  const handleCancelDownload = useCallback(() => {
    Modal.confirm({
      title: '다운로드 취소',
      content: '진행 중인 다운로드를 취소하시겠습니까?',
      okText: '취소',
      okType: 'danger',
      cancelText: '계속',
      onOk: async () => {
        downloadCancelledRef.current = true;
        cancelledCompletionRetainedRef.current = false;

        if (window.electronAPI?.download?.cancel) {
          await window.electronAPI.download.cancel();
          addLog('info', '다운로드 취소 요청 전송됨');
        }

        setIsDownloading(false);
        setIsPaused(false);
        downloadItems.forEach((item) => {
          if (item.status === 'downloading' || item.status === 'pending' || item.status === 'paused') {
            updateItem(item.id, { status: 'cancelled' });
          }
        });
        if (!cancelledCompletionRetainedRef.current) {
          setPackagingStatus('idle');
          addLog('warn', '다운로드 취소됨');
          message.warning('다운로드가 취소되었습니다');
        }
      },
    });
  }, [addLog, downloadItems, setIsDownloading, setIsPaused, setPackagingStatus, updateItem]);

  const executeRetryDownload = useCallback(async (item: DownloadItem) => {
    if (!window.electronAPI?.download?.start) {
      addLog('error', '다운로드 API를 사용할 수 없습니다');
      return;
    }

    const emailDeliveryValidationError = getEmailDeliveryValidationError({
      deliveryMethod,
      smtpHost,
      smtpPort,
      smtpTo: effectiveSmtpTo,
      smtpFrom,
      smtpUser,
    });

    if (emailDeliveryValidationError) {
      message.warning(emailDeliveryValidationError);
      return;
    }

    const previousRetryState = {
      sessionCounter: downloadSessionIdRef.current,
      activeSession: activeDownloadSessionRef.current,
      cartSnapshot: cartSnapshotRef.current,
      historyTrackedItemIds: historyTrackedItemIdsRef.current,
      historySettings: historySettingsSnapshotRef.current,
      downloadCancelled: downloadCancelledRef.current,
      downloadPaused: downloadPausedRef.current,
      cancelledCompletionRetained: cancelledCompletionRetainedRef.current,
      lastSpeedCalc: lastSpeedCalcRef.current,
      speedHistory: [...speedHistoryRef.current],
      startTime,
      isDownloading,
      isPaused,
      packagingStatus,
      packagingProgress,
      completedOutputPath,
      completedArtifactPaths: [...completedArtifactPaths],
      completedDeliveryResult,
      completedError,
      itemState: {
        status: item.status,
        progress: item.progress,
        downloadedBytes: item.downloadedBytes,
        totalBytes: item.totalBytes,
        speed: item.speed,
        error: item.error,
      },
    };
    const sessionSnapshot = createDownloadSessionSnapshot(
      [{
        id: item.id,
        type: item.type as CartItem['type'],
        name: item.name,
        version: item.version,
        arch: item.arch as CartItem['arch'],
        metadata: item.metadata,
        addedAt: Date.now(),
        downloadUrl: item.downloadUrl,
        repository: item.repository as CartItem['repository'],
        location: item.location,
        indexUrl: item.indexUrl,
        extras: item.extras,
        classifier: item.classifier,
      }],
      new Set([item.id]),
      buildHistorySettings({
        outputFormat,
        includeScripts: includeInstallScripts,
        includeDependencies: false,
        deliveryMethod,
        smtpTo: effectiveSmtpTo,
        fileSplitEnabled: enableFileSplit,
        maxFileSizeMB: maxFileSize,
      })
    );
    beginProvisionalDownloadSession(sessionSnapshot, previousRetryState.activeSession);

    const restorePreviousRetryState = () => {
      downloadSessionIdRef.current = previousRetryState.sessionCounter;
      activeDownloadSessionRef.current = previousRetryState.activeSession;
      cartSnapshotRef.current = previousRetryState.cartSnapshot;
      historyTrackedItemIdsRef.current = previousRetryState.historyTrackedItemIds;
      historySettingsSnapshotRef.current = previousRetryState.historySettings;
      downloadCancelledRef.current = previousRetryState.downloadCancelled;
      downloadPausedRef.current = previousRetryState.downloadPaused;
      cancelledCompletionRetainedRef.current = previousRetryState.cancelledCompletionRetained;
      lastSpeedCalcRef.current = previousRetryState.lastSpeedCalc;
      speedHistoryRef.current = [...previousRetryState.speedHistory];
      setStartTime(previousRetryState.startTime);
      setIsDownloading(previousRetryState.isDownloading);
      setIsPaused(previousRetryState.isPaused);
      setPackagingStatus(previousRetryState.packagingStatus);
      setPackagingProgress(previousRetryState.packagingProgress);
      setCompletedOutputPath(previousRetryState.completedOutputPath);
      setCompletedArtifactPaths([...previousRetryState.completedArtifactPaths]);
      setCompletedDeliveryResult(previousRetryState.completedDeliveryResult);
      setCompletedError(previousRetryState.completedError);

      const queuedPreviousCompletion = takeQueuedPreviousCompletion(sessionSnapshot.id);
      if (queuedPreviousCompletion) {
        applyDownloadCompletion(queuedPreviousCompletion.data, queuedPreviousCompletion.sessionSnapshot, {
          updatePackage: updateItem,
          logMessage: addLog,
        });
      }
    };

    downloadCancelledRef.current = false;
    downloadPausedRef.current = false;
    cancelledCompletionRetainedRef.current = false;
    lastSpeedCalcRef.current = { time: 0, bytes: 0 };
    speedHistoryRef.current = [];
    setIsDownloading(true);
    setIsPaused(false);
    setPackagingStatus('idle');
    setPackagingProgress(0);
    setCompletedOutputPath('');
    setCompletedArtifactPaths([]);
    setCompletedDeliveryResult(undefined);
    setCompletedError('');

    retryItem(item.id);
    updateItem(item.id, { status: 'downloading', progress: 0 });

    try {
      const packages = [{
        id: item.id,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
        downloadUrl: item.downloadUrl,
        repository: item.repository,
        location: item.location,
        metadata: item.metadata,
      }];

      const options = buildDownloadStartOptions({
        outputDir,
        outputFormat,
        includeScripts: includeInstallScripts,
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies: false,
        pythonVersion: languageVersions.python,
        concurrency: 1,
        deliveryMethod,
        smtpTo: effectiveSmtpTo,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPassword,
        smtpFrom,
        fileSplitEnabled: enableFileSplit,
        maxFileSizeMB: maxFileSize,
      });

      await window.electronAPI.download.start({
        sessionId: sessionSnapshot.id,
        packages,
        options,
      });
      clearProvisionalDownloadSession(sessionSnapshot.id);
      addLog('info', `재시도 완료: ${item.name}`);
    } catch (error) {
      restorePreviousRetryState();
      addLog('error', `재시도 실패: ${item.name}`, String(error));
      updateItem(item.id, {
        status: 'failed',
        progress: previousRetryState.itemState.progress,
        downloadedBytes: previousRetryState.itemState.downloadedBytes,
        totalBytes: previousRetryState.itemState.totalBytes,
        speed: previousRetryState.itemState.speed,
        error: String(error),
      });
    }
  }, [
    addLog,
    applyDownloadCompletion,
    beginProvisionalDownloadSession,
    clearProvisionalDownloadSession,
    completedArtifactPaths,
    completedDeliveryResult,
    completedError,
    completedOutputPath,
    createDownloadSessionSnapshot,
    defaultArchitecture,
    defaultTargetOS,
    deliveryMethod,
    effectiveSmtpTo,
    enableFileSplit,
    includeInstallScripts,
    isDownloading,
    isPaused,
    languageVersions.python,
    maxFileSize,
    outputDir,
    outputFormat,
    packagingProgress,
    packagingStatus,
    retryItem,
    setIsDownloading,
    setIsPaused,
    setPackagingProgress,
    setPackagingStatus,
    setStartTime,
    smtpFrom,
    smtpHost,
    smtpPassword,
    smtpPort,
    smtpUser,
    startTime,
    takeQueuedPreviousCompletion,
    updateItem,
  ]);

  const resetDependencies = useCallback(() => {
    setDepsResolved(false);
    dependencyResolutionBypassedRef.current = false;
    const items = createPendingDownloadItems(cartItems);
    setItems(items);
    downloadItemsRef.current = items;
    addLog('info', '의존성 확인 초기화');
  }, [addLog, cartItems, setDepsResolved, setItems]);

  const handleComplete = useCallback(() => {
    reset();
    setDepsResolved(false);
    dependencyResolutionBypassedRef.current = false;
    setCompletedOutputPath('');
    setCompletedArtifactPaths([]);
    setCompletedDeliveryResult(undefined);
    setCompletedError('');
    setDeliveryMethod('local');
    provisionalDownloadSessionRef.current = null;
    activeDownloadSessionRef.current = null;
    cartSnapshotRef.current = [];
    historySettingsSnapshotRef.current = null;
    historyTrackedItemIdsRef.current = null;
    osFlow.resetOSFlow();
    navigate('/');
  }, [navigate, osFlow, reset, setDepsResolved]);

  const handleOpenFolder = useCallback(async () => {
    const targetPath = completedOutputPath || outputDir;
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(targetPath);
    } else {
      message.info(`폴더 열기: ${targetPath}`);
    }
    addLog('info', `다운로드 폴더 열기: ${targetPath}`);
  }, [addLog, completedOutputPath, outputDir]);

  const totalDownloadedBytes = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);
  const totalExpectedBytes = downloadItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
  const totalProgress = totalExpectedBytes > 0
    ? (totalDownloadedBytes / totalExpectedBytes) * 100
    : 0;
  const { completedCount, failedCount, skippedCount, allCompleted } = getDownloadCounts(downloadItems);
  const totalSpeed = calculateOverallSpeed();
  const remainingTime = calculateRemainingTime();
  const viewMode = deriveDownloadPageMode({
    cartItemCount: cartItems.length,
    downloadItemCount: downloadItems.length,
    packagingStatus,
    isDedicatedOSFlow: osFlow.isDedicatedOSFlow,
    osDownloading: osFlow.osDownloading,
    hasOSResult: osFlow.osResult !== null,
    requiresOSCartReselection: osFlow.requiresOSCartReselection,
    hasRecoverableFailureArtifacts: hasRecoverableArtifacts(completionArtifacts),
  });

  return {
    viewMode,
    cartItems,
    clearCart,
    outputDir,
    setOutputDir,
    deliveryMethod,
    setDeliveryMethod,
    effectiveSmtpTo,
    outputFormat,
    fileSplitEnabled: enableFileSplit,
    maxFileSizeMB: maxFileSize,
    includeDependencies,
    downloadItems,
    logs,
    isDownloading,
    isPaused,
    depsResolved,
    isResolvingDeps,
    packagingStatus,
    packagingProgress,
    completedCount,
    failedCount,
    skippedCount,
    allCompleted,
    completedOutputPath,
    completedArtifactPaths,
    completedDeliveryResult,
    completedError,
    totalDownloadedBytes,
    totalExpectedBytes,
    totalProgress,
    totalSpeed,
    remainingTime,
    osFlow,
    handleSelectFolder,
    handleResolveDependencies,
    resetDependencies,
    handleStartDownload,
    handlePauseResume,
    handleCancelDownload,
    executeRetryDownload,
    handleComplete,
    handleOpenFolder,
    goToCart: () => navigate('/cart'),
    goToWizard: () => navigate('/wizard'),
  };
}
