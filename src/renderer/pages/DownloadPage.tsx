import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Progress,
  Table,
  Space,
  Typography,
  Radio,
  Input,
  Divider,
  message,
  Empty,
  Tag,
  Alert,
  Modal,
  Collapse,
  List,
  Statistic,
  Row,
  Col,
  Result,
} from 'antd';
import {
  FolderOpenOutlined,
  DownloadOutlined,
  PauseOutlined,
  CaretRightOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ShoppingCartOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  ForwardOutlined,
  FolderOutlined,
  FileZipOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  BranchesOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { OSDownloadProgress, OSDownloadResult, OSPackageCart } from '../components/os';
import { useCartStore, type CartItem } from '../stores/cart-store';
import {
  useDownloadStore,
  DownloadItem,
  DownloadStatus,
  LogEntry,
} from '../stores/download-store';
import { useSettingsStore } from '../stores/settings-store';
import { useHistoryStore } from '../stores/history-store';
import type { HistoryPackageItem, HistorySettings, HistoryStatus } from '../../types';
import type { DependencyAPI } from '../../types/electron';
import type {
  OSPackageInfo,
  OSPackageOutputOptions,
  OSDistribution,
  OSPackageManager,
  OSDownloadProgress as OSDownloadProgressData,
  PackageDependency,
} from '../../core/downloaders/os-shared/types';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

// 상태별 아이콘
const statusIcons: Record<DownloadStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
  downloading: <LoadingOutlined spin style={{ color: '#1890ff' }} />,
  completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  failed: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  cancelled: <StopOutlined style={{ color: '#faad14' }} />,
  skipped: <ForwardOutlined style={{ color: '#faad14' }} />,
  paused: <PauseOutlined style={{ color: '#1890ff' }} />,
};

// 상태별 한글 레이블
const statusLabels: Record<DownloadStatus, string> = {
  pending: '대기',
  downloading: '다운로드 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
  skipped: '건너뜀',
  paused: '일시정지',
};

// 상태별 색상
const statusColors: Record<DownloadStatus, string> = {
  pending: 'default',
  downloading: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  skipped: 'warning',
  paused: 'processing',
};

// 로그 레벨별 아이콘
const logIcons: Record<LogEntry['level'], React.ReactNode> = {
  info: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
  warn: <WarningOutlined style={{ color: '#faad14' }} />,
  error: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  success: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
};

interface PendingDownloadSource {
  id: string;
  name: string;
  version: string;
  type?: string;
  arch?: string;
  downloadUrl?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
  classifier?: string;
  repository?: unknown;
  location?: string;
  indexUrl?: string;
  extras?: string[];
}

const OS_PACKAGE_TYPES = new Set(['yum', 'apt', 'apk']);

type SupportedOSPackageManager = 'yum' | 'apt' | 'apk';

interface OSDownloadResultData {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: string }>;
  skipped: OSPackageInfo[];
  outputPath: string;
  packageManager: OSPackageManager;
  outputOptions: OSPackageOutputOptions;
  generatedOutputs?: Array<{ type: 'archive' | 'repository'; path: string; label: string }>;
  warnings: string[];
  unresolved: PackageDependency[];
  conflicts: Array<{ package: string; versions: OSPackageInfo[] }>;
  cancelled: boolean;
}

interface OSCartContextSnapshot {
  distributionId: string;
  architecture: string;
  packageManager: SupportedOSPackageManager;
}

function isOSCartItem(item: CartItem): item is CartItem & { type: SupportedOSPackageManager } {
  return OS_PACKAGE_TYPES.has(item.type);
}

function getOSCartContextSnapshot(item: CartItem): OSCartContextSnapshot | null {
  const raw = item.metadata?.osContext;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const { distributionId, architecture, packageManager } = raw as Partial<OSCartContextSnapshot>;
  if (
    typeof distributionId !== 'string' ||
    typeof architecture !== 'string' ||
    (packageManager !== 'yum' && packageManager !== 'apt' && packageManager !== 'apk')
  ) {
    return null;
  }

  return {
    distributionId,
    architecture,
    packageManager,
  };
}

function toOSPackageInfo(item: CartItem): OSPackageInfo | null {
  const raw = item.metadata?.osPackageInfo as OSPackageInfo | undefined;
  if (raw) {
    return raw;
  }

  if (!item.repository || !item.location || !item.arch) {
    return null;
  }

  return {
    name: item.name,
    version: item.version,
    architecture: item.arch,
    size: 0,
    checksum: { type: 'sha256', value: '' },
    location: item.location,
    repository: item.repository,
    dependencies: [],
    description: typeof item.metadata?.description === 'string' ? item.metadata.description : undefined,
    summary: typeof item.metadata?.description === 'string' ? item.metadata.description : undefined,
  };
}

function formatDependencyRequirement(requirement: PackageDependency): string {
  if (!requirement.version) {
    return requirement.name;
  }

  return `${requirement.name} ${requirement.operator || '='} ${requirement.version}`;
}

function buildOSDependencyIssueMessage(result: Pick<OSDownloadResultData, 'warnings' | 'unresolved' | 'conflicts'>): string {
  const sections: string[] = [];

  if (result.unresolved.length > 0) {
    sections.push(
      `해결되지 않은 의존성:\n${result.unresolved
        .map((dependency) => `- ${formatDependencyRequirement(dependency)}`)
        .join('\n')}`
    );
  }

  if (result.conflicts.length > 0) {
    sections.push(
      `버전 충돌:\n${result.conflicts
        .map((conflict) => `- ${conflict.package}: ${conflict.versions.map((pkg) => pkg.version).join(', ')}`)
        .join('\n')}`
    );
  }

  if (result.warnings.length > 0) {
    sections.push(`경고:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function createPendingDownloadItems(items: PendingDownloadSource[]): DownloadItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    type: item.type,
    arch: item.arch,
    status: 'pending' as DownloadStatus,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    downloadUrl: item.downloadUrl,
    filename: item.filename,
    metadata: item.metadata,
    classifier: item.classifier,
    repository: item.repository,
    location: item.location,
    indexUrl: item.indexUrl,
    extras: item.extras,
  }));
}

const DownloadPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const removeCartItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const { defaultTargetOS, defaultArchitecture, includeDependencies, languageVersions, cudaVersion, concurrentDownloads, defaultDownloadPath, downloadRenderInterval, yumDistribution, aptDistribution, apkDistribution } = useSettingsStore();
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
    skipItem,
    retryItem,
    setDepsResolved,
    reset,
  } = useDownloadStore();
  const { defaultOutputFormat, includeInstallScripts } = useSettingsStore();
  // 설정 페이지의 outputFormat을 직접 사용
  const outputFormat = defaultOutputFormat;
  const { addHistory } = useHistoryStore();

  const [outputDir, setOutputDir] = useState(outputPath || defaultDownloadPath || '');
  const historyOSOutputOptions = (location.state as { osOutputOptions?: OSPackageOutputOptions } | null)?.osOutputOptions;
  const osCartItems = useMemo(() => cartItems.filter(isOSCartItem), [cartItems]);
  const hasOnlyOSPackages = cartItems.length > 0 && osCartItems.length === cartItems.length;
  const osPackageManagers = useMemo(
    () => Array.from(new Set(osCartItems.map((item) => item.type))),
    [osCartItems]
  );
  const osCartContext = useMemo<OSCartContextSnapshot | null>(() => {
    if (!hasOnlyOSPackages || osPackageManagers.length !== 1) {
      return null;
    }

    const packageManager = osPackageManagers[0] as SupportedOSPackageManager;
    const snapshots = osCartItems.map(getOSCartContextSnapshot);
    const presentSnapshots = snapshots.filter(
      (snapshot): snapshot is OSCartContextSnapshot => snapshot !== null
    );

    if (presentSnapshots.length === 0) {
      return {
        distributionId: packageManager === 'yum'
          ? yumDistribution.id
          : packageManager === 'apt'
          ? aptDistribution.id
          : apkDistribution.id,
        architecture: packageManager === 'yum'
          ? yumDistribution.architecture
          : packageManager === 'apt'
          ? aptDistribution.architecture
          : apkDistribution.architecture,
        packageManager,
      };
    }

    if (presentSnapshots.length !== osCartItems.length) {
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
  }, [
    apkDistribution.architecture,
    apkDistribution.id,
    aptDistribution.architecture,
    aptDistribution.id,
    hasOnlyOSPackages,
    osCartItems,
    osPackageManagers,
    yumDistribution.architecture,
    yumDistribution.id,
  ]);
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
  // 의존성 확인 관련 상태
  const [isResolvingDeps, setIsResolvingDeps] = useState(false);
  const downloadCancelledRef = useRef(false);
  const downloadPausedRef = useRef(false);
  const dependencyResolutionBypassedRef = useRef(false);
  const previousIncludeDependenciesRef = useRef(includeDependencies);
  // 다운로드 아이템 목록을 ref로 유지 (SSE 이벤트 핸들러에서 최신 상태 참조용)
  const downloadItemsRef = useRef<DownloadItem[]>([]);
  // 히스토리 저장용 장바구니 데이터 (다운로드 시작 시 스냅샷)
  const cartSnapshotRef = useRef<typeof cartItems>([]);
  const historySettingsSnapshotRef = useRef<HistorySettings | null>(null);
  // 배치 업데이트용 pending 상태 저장
  const pendingUpdatesRef = useRef<Map<string, Partial<DownloadItem>>>(new Map());
  const pendingLogsRef = useRef<Array<{ level: 'info' | 'warn' | 'error' | 'success'; message: string; details?: string }>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 설정에서 렌더링 간격 사용 (기본값 300ms)

  // 전체 다운로드 속도 계산용 ref
  const lastSpeedCalcRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });
  const speedHistoryRef = useRef<number[]>([]);

  // 초기화
  useEffect(() => {
    if (cartItems.length > 0 && downloadItems.length === 0) {
      const items = createPendingDownloadItems(cartItems);
      setItems(items);
      clearLogs();
    }

  }, [cartItems, downloadItems.length, setItems, clearLogs]);

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
  }, [
    effectiveOSContext,
    shouldRenderDedicatedOSFlow,
  ]);

  useEffect(() => {
    if (!isDedicatedOSFlow || !window.electronAPI?.os?.download?.onProgress) {
      setOSProgress(null);
      return;
    }

    return window.electronAPI.os.download.onProgress((progress) => {
      setOSProgress(progress as OSDownloadProgressData);
    });
  }, [isDedicatedOSFlow]);

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

  // IPC 이벤트 리스너 설정
  useEffect(() => {
    if (!window.electronAPI?.download) return;

    // 배치 업데이트 처리 함수 - 1초마다 한번만 실행
    const flushPendingUpdates = () => {
      const pendingUpdates = pendingUpdatesRef.current;
      const pendingLogs = pendingLogsRef.current;

      // 모든 pending 업데이트를 한번에 적용 (단일 상태 변경)
      if (pendingUpdates.size > 0) {
        updateItemsBatch(new Map(pendingUpdates));
        pendingUpdates.clear();
      }

      // 모든 pending 로그를 한번에 추가 (단일 상태 변경)
      if (pendingLogs.length > 0) {
        addLogsBatch([...pendingLogs]);
        pendingLogsRef.current = [];
      }

      batchTimerRef.current = null;
    };

    // 배치 업데이트 예약 함수
    const scheduleBatchUpdate = (packageId: string, update: Partial<DownloadItem>) => {
      pendingUpdatesRef.current.set(packageId, update);
      // 이미 예약된 타이머가 없으면 1초 후 실행 예약
      if (batchTimerRef.current === null) {
        batchTimerRef.current = setTimeout(flushPendingUpdates, downloadRenderInterval);
      }
    };

    // 로그 배치 예약 함수
    const scheduleLogBatch = (level: 'info' | 'warn' | 'error' | 'success', message: string, details?: string) => {
      pendingLogsRef.current.push({ level, message, details });
      if (batchTimerRef.current === null) {
        batchTimerRef.current = setTimeout(flushPendingUpdates, downloadRenderInterval);
      }
    };

    // 크기 포맷팅 함수
    const formatSize = (bytes: number) => {
      if (!bytes || bytes === 0) return '';
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
      if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${bytes} B`;
    };

    const unsubProgress = window.electronAPI.download.onProgress((progress: unknown) => {
      const p = progress as {
        packageId: string;
        status: string;
        progress: number;
        downloadedBytes: number;
        totalBytes: number;
        speed?: number;
        error?: string;
      };

      // 모든 상태를 배치 업데이트로 처리
      if (p.status === 'completed') {
        scheduleBatchUpdate(p.packageId, {
          status: 'completed',
          progress: 100,
          downloadedBytes: p.totalBytes,
          totalBytes: p.totalBytes,
        });
        const completedItem = downloadItemsRef.current.find(i => i.id === p.packageId);
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
        const item = downloadItemsRef.current.find(i => i.id === p.packageId);
        if (item) {
          const displayName = `${item.name} (v${item.version})`;
          scheduleLogBatch('error', `다운로드 실패: ${displayName}`, p.error);
        }
      } else {
        // downloading/paused 상태
        scheduleBatchUpdate(p.packageId, {
          status: p.status as 'downloading' | 'paused',
          progress: p.progress,
          downloadedBytes: p.downloadedBytes,
          totalBytes: p.totalBytes,
          speed: p.speed || 0,
        });
      }
    });

    // 의존성 해결 상태 리스너
    const unsubStatus = window.electronAPI.download.onStatus?.((status) => {
      if (status.phase === 'resolving') {
        scheduleLogBatch('info', '의존성 분석 중...');
      } else if (status.phase === 'downloading') {
        scheduleLogBatch('info', '다운로드 시작...');
      }
    });

    // 의존성 해결 완료 리스너
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

      const originalCount = originalPackages.length;
      const totalCount = allPackages.length;

      scheduleLogBatch(
        'info',
        `의존성 해결 완료: ${originalCount}개 → ${totalCount}개 패키지`
      );

      // 의존성 관계 맵 생성: packageId -> { parentId, parentName }
      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalIds = new Set(originalPackages.map(p => p.id));

      // 의존성 트리에서 관계 추출 (반복문 기반 - call stack 문제 방지)
      if (dependencyTrees) {
        dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          const rootId = `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;

          const stack: DependencyNodeData[] = [tree.root];
          const visited = new Set<string>();

          while (stack.length > 0) {
            const node = stack.pop()!;
            const nodeId = `${node.package.type || 'pip'}-${node.package.name}-${node.package.version}`;

            if (visited.has(nodeId)) {
              continue;
            }
            visited.add(nodeId);

            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depId = `${depPkg.type || 'pip'}-${depPkg.name}-${depPkg.version}`;

              // 원본 패키지가 아닌 경우에만 의존성으로 표시
              if (!originalIds.has(depId)) {
                dependencyMap.set(depId, { parentId: rootId, parentName: rootName });
              }

              // 스택에 추가 (재귀 호출 대신)
              if (!visited.has(depId)) {
                stack.push(dep);
              }
            });
          }
        });
      }

      // 의존성 포함된 새로운 아이템 목록으로 업데이트
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
      // ref도 업데이트하여 이벤트 핸들러에서 최신 아이템 참조 가능
      downloadItemsRef.current = newItems;

      // 실패한 의존성 해결 경고 표시
      if (failedPackages && failedPackages.length > 0) {
        failedPackages.forEach((failed) => {
          scheduleLogBatch('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }
    });

    // 전체 다운로드 완료 리스너
    const unsubAllComplete = window.electronAPI.download.onAllComplete?.((data) => {
      if (!data.success) {
        setIsDownloading(false);
        setPackagingStatus('failed');
        setPackagingProgress(0);

        if (!data.cancelled) {
          const errorMessage = data.error || '패키징 중 오류가 발생했습니다';
          scheduleLogBatch('error', '다운로드/패키징 실패', errorMessage);
          message.error(errorMessage);
        }

        return;
      }

      // 전체 완료 시 pending/downloading 상태인 아이템만 completed로 변경
      // (failed, skipped 등 다른 상태는 보존)
      // Zustand 스토어에서 직접 최신 상태를 가져옴 (이벤트 처리 타이밍 문제 해결)
      const currentItems = useDownloadStore.getState().items;
      currentItems.forEach((item) => {
        if (item.status === 'downloading' || item.status === 'pending') {
          scheduleBatchUpdate(item.id, { status: 'completed', progress: 100 });
        }
      });

      setIsDownloading(false);
      setPackagingStatus('completed');
      setPackagingProgress(100);
      scheduleLogBatch('success', '다운로드 및 패키징 완료', `다운로드 경로: ${data.outputPath}`);
      message.success('다운로드 및 패키징이 완료되었습니다');

      // 히스토리 저장
      const finalItems = useDownloadStore.getState().items;

      // 패키지 정보 변환 (다운로드 시작 시 저장된 스냅샷 사용)
      const historyPackages: HistoryPackageItem[] = cartSnapshotRef.current.map((item) => ({
        type: item.type,
        name: item.name,
        version: item.version,
        arch: item.arch,
        languageVersion: item.languageVersion,
        metadata: item.metadata,
      }));

      // 설정 정보
      const historySettings = historySettingsSnapshotRef.current ?? {
        outputFormat,
        includeScripts: includeInstallScripts,
        includeDependencies,
      };

      // 상태 계산
      const completedCount = finalItems.filter((i) => i.status === 'completed').length;
      const failedCount = finalItems.filter((i) => i.status === 'failed').length;
      const totalCount = finalItems.length;

      let historyStatus: HistoryStatus = 'success';
      if (failedCount === totalCount) {
        historyStatus = 'failed';
      } else if (failedCount > 0) {
        historyStatus = 'partial';
      }

      // 총 크기 계산
      const totalSize = finalItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);

      // 히스토리 저장
      addHistory(
        historyPackages,
        historySettings,
        data.outputPath,
        totalSize,
        historyStatus,
        completedCount,
        failedCount
      );

      // 실패 없이 모두 완료되면 장바구니 자동 비우기
      if (failedCount === 0) {
        clearCart();
      }
    });

    return () => {
      unsubProgress();
      unsubStatus?.();
      unsubDepsResolved?.();
      unsubAllComplete?.();
      // 배치 업데이트 타이머 취소
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      pendingUpdatesRef.current.clear();
      pendingLogsRef.current = [];
    };
    // downloadItems 대신 downloadItemsRef를 사용하므로 dependency에서 제거
  }, [updateItem, updateItemsBatch, addLog, addLogsBatch, setItems, setIsDownloading, setPackagingStatus, setPackagingProgress, addHistory, clearCart]);

  // downloadItems 변경 시 ref 동기화 (IPC 이벤트 핸들러에서 최신 상태 참조용)
  // updateItem 호출 후에도 ref가 최신 상태를 유지하도록 함
  useEffect(() => {
    downloadItemsRef.current = downloadItems;
  }, [downloadItems]);

  // 폴더 선택
  const handleSelectFolder = async () => {
    if (window.electronAPI?.selectFolder) {
      const result = await window.electronAPI.selectFolder();
      if (result) {
        setOutputDir(result);
        setOutputPath(result);
        addLog('info', `출력 폴더 선택: ${result}`);
      }
    } else {
      // 브라우저 개발 환경에서는 기본 다운로드 경로 사용
      const devOutputPath = './depssmuggler-downloads';
      setOutputDir(devOutputPath);
      setOutputPath(devOutputPath);
      message.warning('브라우저 환경에서는 폴더 선택이 불가능합니다. 개발 서버의 기본 경로를 사용합니다.');
      addLog('info', `개발 환경 다운로드 경로: ${devOutputPath}`);
    }
  };

  // 전체 다운로드 속도 계산 (이동 평균 적용)
  const calculateOverallSpeed = useCallback((): number => {
    if (!isDownloading || !startTime) return 0;

    const now = Date.now();
    const totalDownloaded = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);

    // 최소 500ms 간격으로 속도 계산
    const lastCalc = lastSpeedCalcRef.current;
    const timeDiff = now - lastCalc.time;

    if (timeDiff >= 500 && lastCalc.time > 0) {
      const bytesDiff = totalDownloaded - lastCalc.bytes;
      const instantSpeed = bytesDiff > 0 ? (bytesDiff / timeDiff) * 1000 : 0;

      // 속도 히스토리에 추가 (최대 10개 유지)
      const history = speedHistoryRef.current;
      if (instantSpeed > 0) {
        history.push(instantSpeed);
        if (history.length > 10) {
          history.shift();
        }
      }

      // 참조값 업데이트
      lastSpeedCalcRef.current = { time: now, bytes: totalDownloaded };
    } else if (lastCalc.time === 0 && totalDownloaded > 0) {
      // 최초 계산
      lastSpeedCalcRef.current = { time: now, bytes: totalDownloaded };
    }

    // 이동 평균 계산
    const history = speedHistoryRef.current;
    if (history.length === 0) {
      // 히스토리가 없으면 전체 경과 시간 기반 평균 속도 반환
      const elapsed = now - startTime;
      return elapsed > 0 ? (totalDownloaded / elapsed) * 1000 : 0;
    }

    // 가중 이동 평균 (최근 값에 더 높은 가중치)
    let weightedSum = 0;
    let weightSum = 0;
    history.forEach((speed, index) => {
      const weight = index + 1; // 최근 값일수록 높은 가중치
      weightedSum += speed * weight;
      weightSum += weight;
    });

    return weightSum > 0 ? weightedSum / weightSum : 0;
  }, [isDownloading, startTime, downloadItems]);

  // 남은 시간 계산 (전체 용량/속도 기반)
  const calculateRemainingTime = useCallback(() => {
    if (!isDownloading) return null;

    const overallSpeed = calculateOverallSpeed();
    if (overallSpeed <= 0) return null;

    // 총 예상 바이트와 다운로드된 바이트 계산
    const downloadedBytes = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);
    const expectedBytes = downloadItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
    const remainingBytes = expectedBytes - downloadedBytes;

    if (remainingBytes <= 0) return null;

    // 남은 시간 (밀리초)
    const remainingMs = (remainingBytes / overallSpeed) * 1000;

    if (remainingMs < 60000) {
      return `${Math.ceil(remainingMs / 1000)}초`;
    } else if (remainingMs < 3600000) {
      return `${Math.ceil(remainingMs / 60000)}분`;
    } else {
      return `${Math.floor(remainingMs / 3600000)}시간 ${Math.ceil((remainingMs % 3600000) / 60000)}분`;
    }
  }, [isDownloading, downloadItems, calculateOverallSpeed]);

  // 출력 폴더 검사 및 삭제
  const checkOutputPath = async (): Promise<boolean> => {
    try {
      let data: { exists: boolean; fileCount?: number; totalSize?: number };

      // Electron IPC 사용 (개발/프로덕션 모두)
      if (!window.electronAPI?.download?.checkPath) {
        throw new Error('출력 폴더 검사 API를 사용할 수 없습니다');
      }
      data = await window.electronAPI.download.checkPath(outputDir);

      if (!data.exists || data.fileCount === 0) {
        return true; // 폴더가 없거나 비어있으면 바로 진행
      }

      // 기존 데이터가 있으면 사용자에게 확인
      const formatBytes = (bytes: number) => {
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
                <li>총 크기: <strong>{formatBytes(data.totalSize || 0)}</strong></li>
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
            const onOkStartTime = Date.now();
            window.electronAPI?.log?.('info', '[TIMING] Modal onOk started');
            // Electron IPC 사용 (개발/프로덕션 모두)
            if (!window.electronAPI?.download?.clearPath) {
              message.error('폴더 삭제 API를 사용할 수 없습니다');
              resolve(false);
              return;
            }
            window.electronAPI?.log?.('info', '[TIMING] Calling clearPath IPC...');
            const clearResult = await window.electronAPI.download.clearPath(outputDir);
            window.electronAPI?.log?.('info', `[TIMING] clearPath IPC returned after ${Date.now() - onOkStartTime}ms`);
            if (clearResult.success) {
              message.success('기존 데이터 삭제 완료');
              addLog('info', '기존 데이터 삭제', outputDir);
              window.electronAPI?.log?.('info', `[TIMING] About to resolve(true) at ${Date.now() - onOkStartTime}ms`);
              resolve(true);
              window.electronAPI?.log?.('info', `[TIMING] resolve(true) called at ${Date.now() - onOkStartTime}ms`);
            } else {
              message.error('데이터 삭제 실패');
              resolve(false);
            }
          },
          onCancel: () => {
            resolve(false);
          },
        });
      });
    } catch (error) {
      console.error('폴더 검사 실패:', error);
      return true; // 검사 실패 시 그냥 진행
    }
  };

  // 의존성 확인
  const handleResolveDependencies = async () => {
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

    // 진행 상황 리스너 등록
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
        // pip 커스텀 인덱스 URL 전달
        indexUrl: item.indexUrl,
        // pip extras 전달
        extras: item.extras,
        // Maven classifier 전달
        classifier: item.classifier,
      }));

      const options = {
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies,
        pythonVersion: languageVersions.python,
        cudaVersion,
        // yum 패키지의 repository.baseUrl 추출하여 전달
        yumRepoUrl: cartItems.find(item => item.type === 'yum')?.repository?.baseUrl,
        // OS 패키지 배포판 설정
        yumDistribution,
        aptDistribution,
        apkDistribution,
      };

      // 응답 데이터 타입 정의
      type DependencyResolveResponse = {
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

      let data: DependencyResolveResponse;

      // Electron IPC 사용 (개발/프로덕션 모두)
      if (!dependencyAPI?.resolve) {
        throw new Error('의존성 해결 API를 사용할 수 없습니다');
      }
      data = await dependencyAPI.resolve({ packages, options }) as DependencyResolveResponse;

      const originalCount = data.originalPackages.length;
      const totalCount = data.allPackages.length;

      addLog('info', `의존성 해결 완료: ${originalCount}개 → ${totalCount}개 패키지`);

      // 의존성 관계 맵 생성 (name-version 키 사용)
      interface DependencyNodeData {
        package: { name: string; version: string; type?: string };
        dependencies: DependencyNodeData[];
      }

      // name-version 조합으로 의존성 관계 매핑
      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalNames = new Set(data.originalPackages.map(p => `${p.name}-${p.version}`));

      // 원본 패키지의 name -> 실제 id 매핑 (버전이 다를 수 있으므로 이름으로만 매핑)
      const originalIdByName = new Map<string, string>();
      data.originalPackages.forEach(p => {
        originalIdByName.set(p.name, p.id);
      });

      if (data.dependencyTrees) {
        data.dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          // 원본 패키지의 실제 id 사용 (이름으로 찾기 - latest 등 버전이 실제 버전으로 해결될 수 있음)
          const rootId = originalIdByName.get(rootPkg.name) || `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;

          // 반복문 기반으로 의존성 추출 (call stack 문제 방지)
          const stack: DependencyNodeData[] = [tree.root as DependencyNodeData];
          const visited = new Set<string>();

          while (stack.length > 0) {
            const node = stack.pop()!;
            const nodeKey = `${node.package.name}-${node.package.version}`;

            // 이미 방문한 노드는 스킵 (순환 참조 방지)
            if (visited.has(nodeKey)) {
              continue;
            }
            visited.add(nodeKey);

            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depKey = `${depPkg.name}-${depPkg.version}`;

              // 원본 패키지가 아닌 경우에만 의존성으로 표시
              if (!originalNames.has(depKey)) {
                dependencyMap.set(depKey, { parentId: rootId, parentName: rootName });
              }

              // 스택에 추가 (재귀 호출 대신)
              if (!visited.has(depKey)) {
                stack.push(dep);
              }
            });
          }
        });
      }

      // 의존성 포함된 새로운 아이템 목록으로 업데이트
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
          // 패키지 다운로드 정보 전달 (conda, yum, apt, apk 등에서 사용)
          downloadUrl: pkg.downloadUrl,
          filename: pkg.filename,
          metadata: pkg.metadata,
          // Maven classifier 전달
          classifier: pkg.classifier,
        };
      });

      setItems(newItems);
      downloadItemsRef.current = newItems;

      // 총 크기 계산 및 로그
      const totalSize = newItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
      const formatSize = (bytes: number) => {
        if (!bytes || bytes === 0) return '알 수 없음';
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
      };
      addLog('info', `총 다운로드 크기: ${formatSize(totalSize)}`);

      // 실패한 의존성 해결 경고 표시
      if (data.failedPackages && data.failedPackages.length > 0) {
        data.failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }

      setDepsResolved(true);
      dependencyResolutionBypassedRef.current = false;
      message.success(`의존성 확인 완료: ${totalCount}개 패키지 (${formatSize(totalSize)})`);
    } catch (error) {
      addLog('error', '의존성 확인 실패', String(error));
      message.error('의존성 확인 중 오류가 발생했습니다');
    } finally {
      // 진행 상황 리스너 정리
      unsubscribe?.();
      setIsResolvingDeps(false);
    }
  };

  const addOSDownloadHistory = (result: OSDownloadResultData) => {
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

    const historySettings: HistorySettings = {
      outputFormat: result.outputOptions.archiveFormat || 'zip',
      includeScripts: result.outputOptions.generateScripts,
      includeDependencies,
      osOutputOptions: result.outputOptions,
    };

    const failedCount = result.failed.length + result.unresolved.length;
    const downloadedCount = result.success.length;
    let historyStatus: HistoryStatus = 'success';

    if (result.cancelled || failedCount > 0 || result.skipped.length > 0) {
      historyStatus = downloadedCount > 0 ? 'partial' : 'failed';
    }

    const totalSize = result.success.reduce((sum, item) => sum + (item.size || 0), 0);

    addHistory(
      historyPackages,
      historySettings,
      result.outputPath,
      totalSize,
      historyStatus,
      downloadedCount,
      failedCount
    );
  };

  const handleStartOSDownload = async (outputOptions: OSPackageOutputOptions) => {
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

      if (!result.cancelled) {
        addOSDownloadHistory(result);
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

      if (!result.cancelled && result.failed.length === 0 && result.skipped.length === 0) {
        clearCart();
      }

      if (result.cancelled) {
        message.warning('OS 패키지 다운로드가 취소되었습니다');
      } else if (result.failed.length > 0 || result.skipped.length > 0) {
        message.warning('OS 패키지 다운로드가 부분 완료되었습니다');
      } else {
        message.success('OS 패키지 다운로드가 완료되었습니다');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOSDownloadError(errorMessage);
      message.error('OS 패키지 다운로드 중 오류가 발생했습니다');
    } finally {
      setOSDownloading(false);
    }
  };

  const handleCancelOSDownload = () => {
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
  };

  // 다운로드 시작
  const handleStartDownload = async () => {
    const handleStartTime = Date.now();
    window.electronAPI?.log?.('info', '[TIMING] handleStartDownload started');

    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    if (includeDependencies && !depsResolved) {
      message.warning('먼저 의존성 확인을 진행하세요');
      return;
    }

    // 다운로드 상태 먼저 설정 (취소 버튼 즉시 표시)
    setIsDownloading(true);
    setIsPaused(false);
    setStartTime(Date.now());
    downloadCancelledRef.current = false;
    downloadPausedRef.current = false;
    // 속도 계산 ref 초기화
    lastSpeedCalcRef.current = { time: 0, bytes: 0 };
    speedHistoryRef.current = [];

    // 출력 폴더 검사
    window.electronAPI?.log?.('info', '[TIMING] Calling checkOutputPath...');
    const canProceed = await checkOutputPath();
    window.electronAPI?.log?.('info', `[TIMING] checkOutputPath returned after ${Date.now() - handleStartTime}ms, canProceed=${canProceed}`);
    if (!canProceed) {
      // 진행 취소 시 상태 복원
      setIsDownloading(false);
      return;
    }

    window.electronAPI?.log?.('info', `[TIMING] Proceeding with download at ${Date.now() - handleStartTime}ms`);
    // 히스토리 저장용 장바구니 스냅샷 저장
    cartSnapshotRef.current = [...cartItems];
    historySettingsSnapshotRef.current = {
      outputFormat,
      includeScripts: includeInstallScripts,
      includeDependencies,
    };

    addLog('info', '다운로드 시작', `총 ${downloadItems.length}개 패키지`);

    // Electron IPC 사용 (개발/프로덕션 모두)
    if (!window.electronAPI?.download?.start) {
      addLog('error', '다운로드 API를 사용할 수 없습니다');
      setIsDownloading(false);
      return;
    }

    try {
      // 의존성 해결된 downloadItems 사용 (cartItems가 아닌)
      const packages = downloadItems.map((item: DownloadItem) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
        // 패키지 다운로드 정보 (conda, yum, apt, apk 등에서 사용)
        downloadUrl: item.downloadUrl,
        metadata: item.metadata,
        // OS 패키지용 필드 (레거시 호환)
        repository: item.repository,
        location: item.location,
        // pip 커스텀 인덱스 URL 전달
        indexUrl: item.indexUrl,
        // pip extras 전달
        extras: item.extras,
        // Maven classifier 전달
        classifier: item.classifier,
      }));

      const options = {
        outputDir,
        outputFormat,
        includeScripts: includeInstallScripts,
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies,
        pythonVersion: languageVersions.python,
        concurrency: concurrentDownloads,
      };

      window.electronAPI?.log?.('info', `[TIMING] Calling download.start IPC at ${Date.now() - handleStartTime}ms`);
      await window.electronAPI.download.start({ packages, options });
      window.electronAPI?.log?.('info', `[TIMING] download.start IPC returned at ${Date.now() - handleStartTime}ms`);
    } catch (error) {
      addLog('error', '다운로드 시작 실패', String(error));
      setIsDownloading(false);
    }
  };

  // 일시정지/재개
  const handlePauseResume = async () => {
    if (isPaused) {
      downloadPausedRef.current = false;
      setIsPaused(false);
      // IPC로 메인 프로세스에 재개 요청
      if (window.electronAPI?.download?.resume) {
        await window.electronAPI.download.resume();
      }
      addLog('info', '다운로드 재개');
    } else {
      downloadPausedRef.current = true;
      setIsPaused(true);
      // IPC로 메인 프로세스에 일시정지 요청
      if (window.electronAPI?.download?.pause) {
        await window.electronAPI.download.pause();
      }
      addLog('info', '다운로드 일시정지');
    }
  };

  // 다운로드 취소
  const handleCancelDownload = () => {
    Modal.confirm({
      title: '다운로드 취소',
      content: '진행 중인 다운로드를 취소하시겠습니까?',
      okText: '취소',
      okType: 'danger',
      cancelText: '계속',
      onOk: async () => {
        downloadCancelledRef.current = true;

        // Electron IPC 사용 (개발/프로덕션 모두)
        if (window.electronAPI?.download?.cancel) {
          await window.electronAPI.download.cancel();
          addLog('info', '다운로드 취소 요청 전송됨');
        }

        // UI 상태 업데이트
        setIsDownloading(false);
        setIsPaused(false);
        downloadItems.forEach((item) => {
          if (item.status === 'downloading' || item.status === 'pending' || item.status === 'paused') {
            updateItem(item.id, { status: 'cancelled' });
          }
        });
        setPackagingStatus('idle');
        addLog('warn', '다운로드 취소됨');
        message.warning('다운로드가 취소되었습니다');
      },
    });
  };

  // 단일 패키지 재다운로드 실행
  const executeRetryDownload = async (item: DownloadItem) => {
    if (!window.electronAPI?.download?.start) {
      addLog('error', '다운로드 API를 사용할 수 없습니다');
      return;
    }

    // 상태를 pending → downloading으로 변경
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

      const options = {
        outputDir,
        outputFormat,
        includeScripts: includeInstallScripts,
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies: false, // 재시도 시 의존성 해결 불필요
        pythonVersion: languageVersions.python,
        concurrency: 1, // 단일 패키지이므로 1
      };

      await window.electronAPI.download.start({ packages, options });
      addLog('info', `재시도 완료: ${item.name}`);
    } catch (error) {
      addLog('error', `재시도 실패: ${item.name}`, String(error));
      updateItem(item.id, { status: 'failed', error: String(error) });
    }
  };

  // 완료 후 초기화 (장바구니는 유지, 다운로드 상태만 초기화)
  const handleComplete = () => {
    reset();
    setDepsResolved(false);
    dependencyResolutionBypassedRef.current = false;
    setOSProgress(null);
    setOSResult(null);
    setOSDownloadError(null);
    setOSDownloading(false);
    navigate('/');
  };

  // 다운로드 폴더 열기 (Finder/Explorer)
  const handleOpenFolder = async () => {
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(outputDir);
    } else {
      message.info(`폴더 열기: ${outputDir}`);
    }
    addLog('info', `다운로드 폴더 열기: ${outputDir}`);
  };

  // 테이블 컬럼
  const columns = [
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: DownloadStatus) => (
        <Space>
          {statusIcons[status]}
          <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
        </Space>
      ),
    },
    {
      title: '패키지',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: DownloadItem) => (
        <div>
          <div>
            <Text strong>{name}</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              {record.version}
            </Text>
            {record.type && (
              <Tag style={{ marginLeft: 8 }}>{record.type}</Tag>
            )}
          </div>
          {record.filename && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              {record.filename}
            </Text>
          )}
          {record.status === 'failed' && record.error && (
            <Text type="danger" style={{ fontSize: 12 }}>
              {record.error}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '진행률',
      dataIndex: 'progress',
      key: 'progress',
      width: 200,
      render: (progress: number, record: DownloadItem) => (
        <Progress
          percent={Math.round(progress)}
          size="small"
          status={
            record.status === 'failed'
              ? 'exception'
              : record.status === 'completed'
              ? 'success'
              : record.status === 'paused'
              ? 'normal'
              : 'active'
          }
        />
      ),
    },
    {
      title: '크기',
      dataIndex: 'totalBytes',
      key: 'size',
      width: 100,
      render: (totalBytes: number) => {
        if (!totalBytes || totalBytes === 0) return '-';
        if (totalBytes >= 1024 * 1024 * 1024) {
          return `${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        }
        if (totalBytes >= 1024 * 1024) {
          return `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
        }
        if (totalBytes >= 1024) {
          return `${(totalBytes / 1024).toFixed(1)} KB`;
        }
        return `${totalBytes} B`;
      },
    },
    {
      title: '액션',
      key: 'action',
      width: 100,
      render: (_: unknown, record: DownloadItem) => (
        <Space>
          {record.status === 'failed' && (
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => executeRetryDownload(record)}
            >
              재시도
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // 전체 진행률 계산 (바이트 기반)
  const totalDownloadedBytes = downloadItems.reduce((sum, item) => sum + (item.downloadedBytes || 0), 0);
  const totalExpectedBytes = downloadItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
  const totalProgress = totalExpectedBytes > 0
    ? (totalDownloadedBytes / totalExpectedBytes) * 100
    : 0;

  const completedCount = downloadItems.filter((item) => item.status === 'completed').length;
  const failedCount = downloadItems.filter((item) => item.status === 'failed').length;
  const skippedCount = downloadItems.filter((item) => item.status === 'skipped').length;
  const allCompleted =
    downloadItems.length > 0 &&
    downloadItems.every((item) => ['completed', 'skipped'].includes(item.status));
  const hasAnyCompleted = completedCount > 0;

  // 전체 다운로드 속도 (이동 평균 기반)
  const totalSpeed = calculateOverallSpeed();
  const isOSPackaging = osProgress?.phase === 'packaging';

  // 크기 포맷팅 함수
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '-';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  // 원본 패키지와 의존성 패키지 분류
  const originalPackages = downloadItems.filter((item) => !item.isDependency);
  const dependencyPackages = downloadItems.filter((item) => item.isDependency);

  // 원본 패키지별로 의존성 그룹화
  const getPackageDependencies = (parentId: string) => {
    return dependencyPackages.filter((item) => item.parentId === parentId);
  };

  // 패키지별 완료 상태 계산
  const getPackageGroupStatus = (parentItem: DownloadItem) => {
    const deps = getPackageDependencies(parentItem.id);
    const allItems = [parentItem, ...deps];
    const completedCount = allItems.filter((i) => i.status === 'completed').length;
    const failedCount = allItems.filter((i) => i.status === 'failed').length;
    const downloadingCount = allItems.filter((i) => i.status === 'downloading').length;

    return {
      total: allItems.length,
      completed: completedCount,
      failed: failedCount,
      downloading: downloadingCount,
      isAllCompleted: allItems.every((i) => ['completed', 'skipped'].includes(i.status)),
      hasFailures: failedCount > 0,
    };
  };

  if (shouldRenderDedicatedOSFlow) {
    return (
      <div>
        <Title level={3}>OS 패키지 다운로드</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {osDistribution
            ? `${osDistribution.name}용 로컬 저장소 또는 압축 결과물을 생성합니다.`
            : '배포판 정보를 불러오는 중입니다.'}
        </Text>

        <Card title="다운로드 경로" style={{ marginBottom: 24 }}>
          <Text strong>출력 폴더</Text>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="다운로드 폴더 경로"
              disabled={osDownloading}
            />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleSelectFolder}
              disabled={osDownloading}
            >
              선택
            </Button>
          </Space.Compact>
        </Card>

        {osDownloadError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 24 }}
            message="OS 패키지 다운로드 실패"
            description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{osDownloadError}</pre>}
          />
        )}

        {osResult ? (
          <OSDownloadResult
            success={osResult.success}
            failed={osResult.failed}
            skipped={osResult.skipped}
            outputPath={osResult.outputPath}
            outputOptions={osResult.outputOptions}
            packageManager={osResult.packageManager}
            generatedOutputs={osResult.generatedOutputs}
            warnings={osResult.warnings}
            conflicts={osResult.conflicts}
            cancelled={osResult.cancelled}
            onOpenFolder={handleOpenFolder}
            onClose={handleComplete}
          />
        ) : osDownloading ? (
          <div>
            <OSDownloadProgress
              progress={osProgress}
              packageCount={osPackages.length}
              outputDir={outputDir}
            />
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleCancelOSDownload}
                disabled={isOSPackaging}
              >
                다운로드 취소
              </Button>
            </div>
          </div>
        ) : (
          <OSPackageCart
            packages={osPackages}
            distribution={osDistribution}
            isDownloading={osDownloading}
            initialOutputOptions={historyOSOutputOptions}
            onRemovePackage={(pkg) => {
              const item = osCartItems.find(
                (cartItem) =>
                  cartItem.name === pkg.name &&
                  cartItem.version === pkg.version &&
                  cartItem.type === activeOSPackageManager
              );
              if (item) {
                removeCartItem(item.id);
              }
            }}
            onClearAll={clearCart}
            onStartDownload={handleStartOSDownload}
          />
        )}
      </div>
    );
  }

  // 빈 장바구니 상태
  if (cartItems.length === 0 && downloadItems.length === 0) {
    return (
      <Card>
        <Empty description="다운로드할 패키지가 없습니다">
          <Button
            type="primary"
            icon={<ShoppingCartOutlined />}
            onClick={() => navigate('/cart')}
          >
            장바구니로 이동
          </Button>
        </Empty>
      </Card>
    );
  }

  // 완료 화면
  if (packagingStatus === 'completed' && allCompleted) {
    return (
      <div>
        <Result
          status="success"
          title="다운로드 완료"
          subTitle={`${completedCount}개 패키지가 성공적으로 다운로드되었습니다`}
          extra={[
            <Button
              type="primary"
              key="open"
              icon={<FolderOpenOutlined />}
              onClick={handleOpenFolder}
            >
              다운로드 폴더 열기
            </Button>,
            <Button key="done" icon={<ReloadOutlined />} onClick={handleComplete}>
              새 다운로드
            </Button>,
          ]}
        />

        <Card title="다운로드 결과" style={{ marginTop: 24 }}>
          <Row gutter={24}>
            <Col span={6}>
              <Statistic
                title="완료"
                value={completedCount}
                suffix="개"
                valueStyle={{ color: '#52c41a' }}
                prefix={<CheckCircleOutlined />}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="실패"
                value={failedCount}
                suffix="개"
                valueStyle={{ color: failedCount > 0 ? '#ff4d4f' : undefined }}
                prefix={<CloseCircleOutlined />}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="건너뜀"
                value={skippedCount}
                suffix="개"
                valueStyle={{ color: skippedCount > 0 ? '#faad14' : undefined }}
                prefix={<ForwardOutlined />}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="출력 형식"
                value={outputFormat.toUpperCase()}
                prefix={<FileZipOutlined />}
              />
            </Col>
          </Row>

          <Divider />

          <div>
            <Text strong>다운로드 경로:</Text>
            <Paragraph copyable style={{ marginTop: 8 }}>
              {outputDir}
            </Paragraph>
          </div>
        </Card>

        {/* 다운로드된 패키지 목록 */}
        <Card title="다운로드된 패키지" style={{ marginTop: 24 }}>
          <Table
            dataSource={downloadItems}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ y: 300 }}
          />
        </Card>

        {/* 로그 */}
        <Card
          size="small"
          title={
            <Space>
              <span>로그</span>
              <Tag>{logs.length}개</Tag>
            </Space>
          }
          style={{ marginTop: 24 }}
          styles={{ body: { padding: 0 } }}
        >
          <div
            style={{
              height: 200,
              overflow: 'auto',
              backgroundColor: '#1a1a1a',
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {logs.length === 0 ? (
              <Text type="secondary" style={{ color: '#666' }}>로그가 없습니다</Text>
            ) : (
              logs.map((log, index) => (
                <div key={index} style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ flexShrink: 0 }}>{logIcons[log.level]}</span>
                  <Text style={{ color: '#888', flexShrink: 0, minWidth: 70 }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text style={{ color: log.level === 'error' ? '#ff4d4f' : log.level === 'warn' ? '#faad14' : '#d9d9d9' }}>
                    {log.message}
                    {log.details && <span style={{ color: '#888' }}> - {log.details}</span>}
                  </Text>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Title level={3}>다운로드</Title>

      {/* 다운로드 경로 설정 */}
      <Card title="다운로드 경로" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong>다운로드 폴더</Text>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="다운로드 폴더 경로"
              disabled={isDownloading}
            />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleSelectFolder}
              disabled={isDownloading}
            >
              선택
            </Button>
          </Space.Compact>
        </div>

      </Card>

      {/* 진행 상황 */}
      <Card
        title={
          <Space>
            <span>다운로드 진행</span>
            <Tag color="blue">{downloadItems.length}개 패키지</Tag>
            {completedCount > 0 && <Tag color="green">{completedCount}개 완료</Tag>}
            {failedCount > 0 && <Tag color="red">{failedCount}개 실패</Tag>}
            {skippedCount > 0 && <Tag color="orange">{skippedCount}개 건너뜀</Tag>}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {/* 전체 진행률 */}
        <Progress
          percent={Math.round(totalProgress)}
          format={() => totalExpectedBytes > 0
            ? `${formatBytes(totalDownloadedBytes)} / ${formatBytes(totalExpectedBytes)}`
            : `${Math.round(totalProgress)}%`
          }
          status={
            failedCount > 0 && !isDownloading
              ? 'exception'
              : allCompleted
              ? 'success'
              : isPaused
              ? 'normal'
              : 'active'
          }
          style={{ marginBottom: 16 }}
        />

        {/* 상태 정보 */}
        {isDownloading && (
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Statistic
                title="다운로드 속도"
                value={totalSpeed > 1024 * 1024
                  ? (totalSpeed / 1024 / 1024).toFixed(1)
                  : (totalSpeed / 1024).toFixed(1)}
                suffix={totalSpeed > 1024 * 1024 ? 'MB/s' : 'KB/s'}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="예상 남은 시간"
                value={calculateRemainingTime() || '-'}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="진행 상황"
                value={`${completedCount}/${downloadItems.length}`}
                suffix="완료"
                valueStyle={{ color: isPaused ? '#faad14' : '#1890ff' }}
              />
            </Col>
          </Row>
        )}

        {/* 패키징 진행률 */}
        {packagingStatus === 'packaging' && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>패키징 진행 중...</Text>
            <Progress percent={packagingProgress} status="active" />
          </div>
        )}

        {/* 의존성 포함 시에만 Collapse 트리 구조를 표시하고, 그 외에는 기본 Table을 사용 */}
        {includeDependencies && depsResolved ? (
          <Collapse
            bordered={false}
            expandIcon={({ isActive }) => (
              <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: 12 }} />
            )}
            style={{ background: 'transparent' }}
            defaultActiveKey={originalPackages.map(p => p.id)}
          >
            {originalPackages.map((pkg) => {
              const deps = getPackageDependencies(pkg.id);
              const groupStatus = getPackageGroupStatus(pkg);

              return (
                <Panel
                  key={pkg.id}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Space>
                          {statusIcons[pkg.status]}
                          <Text strong>{pkg.name}</Text>
                          <Text type="secondary">{pkg.version}</Text>
                          {pkg.type && <Tag>{pkg.type}</Tag>}
                          {deps.length > 0 && (
                            <Tag icon={<BranchesOutlined />} color="blue">
                              +{deps.length} 의존성
                            </Tag>
                          )}
                        </Space>
                        {pkg.filename && (
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 24 }}>
                            {pkg.filename}
                          </Text>
                        )}
                      </div>
                      <Space style={{ marginRight: 24 }}>
                        {groupStatus.hasFailures && (
                          <Tag color="error">{groupStatus.failed} 실패</Tag>
                        )}
                        <Tag color={groupStatus.isAllCompleted ? 'success' : 'processing'}>
                          {groupStatus.completed}/{groupStatus.total} 완료
                        </Tag>
                        <Text type="secondary" style={{ minWidth: 70, textAlign: 'right' }}>
                          {formatBytes(pkg.totalBytes)}
                        </Text>
                        <Progress
                          percent={Math.round(pkg.progress)}
                          size="small"
                          style={{ width: 100, marginBottom: 0 }}
                          status={
                            pkg.status === 'failed'
                              ? 'exception'
                              : pkg.status === 'completed'
                              ? 'success'
                              : 'active'
                          }
                        />
                      </Space>
                    </div>
                  }
                >
                  {/* 의존성 목록 */}
                  {deps.length > 0 ? (
                    <List
                      size="small"
                      dataSource={deps}
                      renderItem={(dep) => (
                        <List.Item
                          style={{ padding: '8px 12px' }}
                          extra={
                            <Space>
                              <Text type="secondary" style={{ minWidth: 70, textAlign: 'right' }}>
                                {formatBytes(dep.totalBytes)}
                              </Text>
                              <Progress
                                percent={Math.round(dep.progress)}
                                size="small"
                                style={{ width: 100, marginBottom: 0 }}
                                status={
                                  dep.status === 'failed'
                                    ? 'exception'
                                    : dep.status === 'completed'
                                    ? 'success'
                                    : 'active'
                                }
                              />
                              {dep.status === 'failed' && (
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  onClick={() => executeRetryDownload(dep)}
                                >
                                  재시도
                                </Button>
                              )}
                            </Space>
                          }
                        >
                          <div>
                            <Space>
                              {statusIcons[dep.status]}
                              <Text>{dep.name}</Text>
                              <Text type="secondary">{dep.version}</Text>
                              <Tag color={statusColors[dep.status]} style={{ marginLeft: 4 }}>
                                {statusLabels[dep.status]}
                              </Tag>
                            </Space>
                            {dep.filename && (
                              <div style={{ marginLeft: 24, marginTop: 2 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {dep.filename}
                                </Text>
                              </div>
                            )}
                            {dep.status === 'failed' && dep.error && (
                              <div style={{ marginLeft: 24, marginTop: 4 }}>
                                <Text type="danger" style={{ fontSize: 12 }}>
                                  {dep.error}
                                </Text>
                              </div>
                            )}
                          </div>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Text type="secondary">의존성 없음</Text>
                  )}
                </Panel>
              );
            })}
          </Collapse>
        ) : (
          <Table
            columns={columns}
            dataSource={downloadItems}
            rowKey="id"
            pagination={downloadItems.length > 10 ? { pageSize: 10 } : false}
            size="small"
          />
        )}
      </Card>

      {/* 액션 버튼 */}
      <Card style={{ marginBottom: 24 }}>
        <Space>
          {includeDependencies && !isDownloading && !allCompleted && !depsResolved && (
            <Button
              type="primary"
              icon={isResolvingDeps ? <LoadingOutlined /> : <SearchOutlined />}
              size="large"
              onClick={handleResolveDependencies}
              disabled={!outputDir || isResolvingDeps}
              loading={isResolvingDeps}
            >
              {isResolvingDeps ? '의존성 확인 중...' : '의존성 확인'}
            </Button>
          )}
          {!isDownloading && !allCompleted && (depsResolved || !includeDependencies) && (
            <>
              {includeDependencies && depsResolved && (
                <Button
                  icon={<SearchOutlined />}
                  size="large"
                  onClick={() => {
                    setDepsResolved(false);
                    dependencyResolutionBypassedRef.current = false;
                    const items = createPendingDownloadItems(cartItems);
                    setItems(items);
                    downloadItemsRef.current = items;
                    addLog('info', '의존성 확인 초기화');
                  }}
                >
                  다시 확인
                </Button>
              )}
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                size="large"
                onClick={handleStartDownload}
                disabled={!outputDir}
              >
                다운로드 시작
              </Button>
            </>
          )}
          {isDownloading && (
            <>
              <Button
                icon={isPaused ? <CaretRightOutlined /> : <PauseOutlined />}
                size="large"
                onClick={handlePauseResume}
              >
                {isPaused ? '재개' : '일시정지'}
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                size="large"
                onClick={handleCancelDownload}
              >
                취소
              </Button>
            </>
          )}
          {(allCompleted || packagingStatus === 'completed') && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              size="large"
              onClick={handleComplete}
            >
              완료
            </Button>
          )}
        </Space>
      </Card>

      {/* 로그 섹션 */}
      <Card
        size="small"
        title={
          <Space>
            <span>로그</span>
            <Tag>{logs.length}개</Tag>
          </Space>
        }
        style={{ marginTop: 16 }}
        styles={{ body: { padding: 0 } }}
      >
        <div
          style={{
            height: 200,
            overflow: 'auto',
            backgroundColor: '#1a1a1a',
            padding: '8px 12px',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          {logs.length === 0 ? (
            <Text type="secondary" style={{ color: '#666' }}>로그가 없습니다</Text>
          ) : (
            logs.map((log, index) => (
              <div key={index} style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0 }}>{logIcons[log.level]}</span>
                <Text style={{ color: '#888', flexShrink: 0, minWidth: 70 }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={{ color: log.level === 'error' ? '#ff4d4f' : log.level === 'warn' ? '#faad14' : '#d9d9d9' }}>
                  {log.message}
                  {log.details && <span style={{ color: '#888' }}> - {log.details}</span>}
                </Text>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default DownloadPage;
