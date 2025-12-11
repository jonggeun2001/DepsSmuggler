import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useCartStore } from '../stores/cartStore';
import {
  useDownloadStore,
  DownloadItem,
  DownloadStatus,
  LogEntry,
} from '../stores/downloadStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useHistoryStore } from '../stores/historyStore';
import type { HistoryPackageItem, HistorySettings, HistoryStatus } from '../../types';
import type { DependencyAPI } from '../../types/electron';

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

const DownloadPage: React.FC = () => {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const { defaultTargetOS, defaultArchitecture, includeDependencies, languageVersions, concurrentDownloads, defaultDownloadPath } = useSettingsStore();
  const {
    items: downloadItems,
    isDownloading,
    isPaused,
    outputPath,
    packagingStatus,
    packagingProgress,
    logs,
    startTime,
    setItems,
    updateItem,
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
    reset,
  } = useDownloadStore();
  const { defaultOutputFormat, includeInstallScripts } = useSettingsStore();
  // 설정 페이지의 outputFormat을 직접 사용
  const outputFormat = defaultOutputFormat;
  const { addHistory } = useHistoryStore();

  const [outputDir, setOutputDir] = useState(outputPath || defaultDownloadPath || '');
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorItem, setErrorItem] = useState<DownloadItem | null>(null);
  // 의존성 확인 관련 상태
  const [isResolvingDeps, setIsResolvingDeps] = useState(false);
  const [depsResolved, setDepsResolved] = useState(false);
  const downloadCancelledRef = useRef(false);
  const downloadPausedRef = useRef(false);
  // 다운로드 아이템 목록을 ref로 유지 (SSE 이벤트 핸들러에서 최신 상태 참조용)
  const downloadItemsRef = useRef<DownloadItem[]>([]);
  // SSE 연결 및 클라이언트 ID 관리 (취소 시 사용)
  const eventSourceRef = useRef<EventSource | null>(null);
  const clientIdRef = useRef<string>('');
  // 히스토리 저장용 장바구니 데이터 (다운로드 시작 시 스냅샷)
  const cartSnapshotRef = useRef<typeof cartItems>([]);

  // 초기화
  useEffect(() => {
    if (cartItems.length > 0 && downloadItems.length === 0) {
      const items: DownloadItem[] = cartItems.map((item) => ({
        id: item.id,
        name: item.name,
        version: item.version,
        type: item.type,
        status: 'pending' as DownloadStatus,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
      }));
      setItems(items);
      clearLogs();
    }

  }, [cartItems, downloadItems.length, setItems, clearLogs]);

  // IPC 이벤트 리스너 설정 (프로덕션 Electron 환경에서만)
  useEffect(() => {
    // 개발 환경에서는 HTTP/SSE를 사용하므로 IPC 리스너 불필요
    const isDevelopment = import.meta.env.DEV;
    if (isDevelopment || !window.electronAPI?.download) return;

    const unsubProgress = window.electronAPI.download.onProgress((progress: unknown) => {
      const p = progress as { id: string; percent: number; downloaded: number; total: number; speed: number };
      updateItem(p.id, {
        progress: p.percent,
        downloadedBytes: p.downloaded,
        totalBytes: p.total,
        speed: p.speed,
      });
    });

    const unsubComplete = window.electronAPI.download.onComplete((result: unknown) => {
      const r = result as { id: string };
      updateItem(r.id, { status: 'completed', progress: 100 });
      // ref를 사용하여 최신 아이템 목록에서 조회 (클로저 문제 방지)
      const completedItem = downloadItemsRef.current.find(i => i.id === r.id);
      const displayName = completedItem
        ? `${completedItem.name} (v${completedItem.version})`
        : r.id;
      addLog('success', `다운로드 완료: ${displayName}`);
    });

    const unsubError = window.electronAPI.download.onError((error: unknown) => {
      const e = error as { id: string; message: string };
      // ref를 사용하여 최신 아이템 목록에서 조회 (클로저 문제 방지)
      const item = downloadItemsRef.current.find(i => i.id === e.id);
      if (item) {
        updateItem(e.id, { status: 'failed', error: e.message });
        setErrorItem({ ...item, error: e.message });
        setErrorModalOpen(true);
        const displayName = `${item.name} (v${item.version})`;
        addLog('error', `다운로드 실패: ${displayName}`, e.message);
      }
    });

    // 의존성 해결 상태 리스너
    const unsubStatus = window.electronAPI.download.onStatus?.((status) => {
      if (status.phase === 'resolving') {
        addLog('info', '의존성 분석 중...');
      } else if (status.phase === 'downloading') {
        addLog('info', '다운로드 시작...');
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

      const originalPackages = data.originalPackages as Array<{ id: string; name: string; version: string; type: string }>;
      const allPackages = data.allPackages as Array<{ id: string; name: string; version: string; type: string }>;
      const dependencyTrees = data.dependencyTrees as DependencyTreeData[] | undefined;
      const failedPackages = data.failedPackages as Array<{ name: string; version: string; error: string }> | undefined;

      const originalCount = originalPackages.length;
      const totalCount = allPackages.length;

      addLog(
        'info',
        `의존성 해결 완료: ${originalCount}개 → ${totalCount}개 패키지`
      );

      // 의존성 관계 맵 생성: packageId -> { parentId, parentName }
      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalIds = new Set(originalPackages.map(p => p.id));

      // 의존성 트리에서 관계 추출
      if (dependencyTrees) {
        dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          const rootId = `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;

          // 재귀적으로 의존성 노드 탐색
          const extractDeps = (node: DependencyNodeData, parentId: string, parentName: string) => {
            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depId = `${depPkg.type || 'pip'}-${depPkg.name}-${depPkg.version}`;

              // 원본 패키지가 아닌 경우에만 의존성으로 표시
              if (!originalIds.has(depId)) {
                dependencyMap.set(depId, { parentId, parentName });
              }

              // 재귀 호출 (이 의존성의 하위 의존성들)
              extractDeps(dep, rootId, rootName);
            });
          };

          extractDeps(tree.root, rootId, rootName);
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
        };
      });
      setItems(newItems);
      // ref도 업데이트하여 이벤트 핸들러에서 최신 아이템 참조 가능
      downloadItemsRef.current = newItems;

      // 실패한 의존성 해결 경고 표시
      if (failedPackages && failedPackages.length > 0) {
        failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }
    });

    // 전체 다운로드 완료 리스너
    const unsubAllComplete = window.electronAPI.download.onAllComplete?.((data) => {
      // 전체 완료 시 pending/downloading 상태인 아이템만 completed로 변경
      // (failed, skipped 등 다른 상태는 보존)
      // Zustand 스토어에서 직접 최신 상태를 가져옴 (이벤트 처리 타이밍 문제 해결)
      const currentItems = useDownloadStore.getState().items;
      currentItems.forEach((item) => {
        if (item.status === 'downloading' || item.status === 'pending') {
          updateItem(item.id, { status: 'completed', progress: 100 });
        }
      });

      setIsDownloading(false);
      setPackagingStatus('completed');
      setPackagingProgress(100);
      addLog('success', '다운로드 및 패키징 완료', `다운로드 경로: ${data.outputPath}`);
      message.success('다운로드 및 패키징이 완료되었습니다');

      // 히스토리 저장
      const finalItems = useDownloadStore.getState().items;
      const settings = useSettingsStore.getState();

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
      const historySettings: HistorySettings = {
        outputFormat: settings.defaultOutputFormat,
        includeScripts: settings.includeInstallScripts,
        includeDependencies: settings.includeDependencies,
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
      unsubComplete();
      unsubError();
      unsubStatus?.();
      unsubDepsResolved?.();
      unsubAllComplete?.();
    };
    // downloadItems 대신 downloadItemsRef를 사용하므로 dependency에서 제거
  }, [updateItem, addLog, setItems, setIsDownloading, setPackagingStatus, setPackagingProgress, addHistory, clearCart]);

  // 컴포넌트 언마운트 시 SSE 연결 정리
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // downloadItems 변경 시 ref 동기화 (SSE 이벤트 핸들러에서 최신 상태 참조용)
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

  // 남은 시간 계산
  const calculateRemainingTime = useCallback(() => {
    if (!startTime || !isDownloading) return null;

    const totalProgress = downloadItems.reduce((sum, item) => sum + item.progress, 0) / downloadItems.length;
    if (totalProgress === 0) return null;

    const elapsed = Date.now() - startTime;
    const estimated = (elapsed / totalProgress) * (100 - totalProgress);

    if (estimated < 60000) {
      return `${Math.ceil(estimated / 1000)}초`;
    } else if (estimated < 3600000) {
      return `${Math.ceil(estimated / 60000)}분`;
    } else {
      return `${Math.floor(estimated / 3600000)}시간 ${Math.ceil((estimated % 3600000) / 60000)}분`;
    }
  }, [startTime, isDownloading, downloadItems]);

  // 출력 폴더 검사 및 삭제
  const checkOutputPath = async (): Promise<boolean> => {
    const isDevelopment = import.meta.env.DEV;

    try {
      let data: { exists: boolean; fileCount?: number; totalSize?: number };

      // Electron 환경에서는 IPC API 사용, 개발 환경에서는 HTTP API 사용
      if (!isDevelopment && window.electronAPI?.download?.checkPath) {
        data = await window.electronAPI.download.checkPath(outputDir);
      } else {
        const response = await fetch('/api/download/check-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputDir }),
        });
        data = await response.json();
      }

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
            // Electron 환경에서는 IPC API 사용, 개발 환경에서는 HTTP API 사용
            if (!isDevelopment && window.electronAPI?.download?.clearPath) {
              const clearResult = await window.electronAPI.download.clearPath(outputDir);
              if (clearResult.success) {
                message.success('기존 데이터 삭제 완료');
                addLog('info', '기존 데이터 삭제', outputDir);
                resolve(true);
              } else {
                message.error('데이터 삭제 실패');
                resolve(false);
                throw new Error('삭제 실패'); // 모달 닫힘 방지
              }
            } else {
              const clearResponse = await fetch('/api/download/clear-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outputDir }),
              });

              if (clearResponse.ok) {
                message.success('기존 데이터 삭제 완료');
                addLog('info', '기존 데이터 삭제', outputDir);
                resolve(true);
              } else {
                message.error('데이터 삭제 실패');
                resolve(false);
                throw new Error('삭제 실패'); // 모달 닫힘 방지
              }
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

    setIsResolvingDeps(true);
    setDepsResolved(false);
    addLog('info', '의존성 확인 시작', `${cartItems.length}개 패키지`);

    const isDevelopment = import.meta.env.DEV;

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
      }));

      const options = {
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        includeDependencies,
        pythonVersion: languageVersions.python,
      };

      // 응답 데이터 타입 정의
      type DependencyResolveResponse = {
        originalPackages: Array<{ id: string; name: string; version: string; type: string }>;
        allPackages: Array<{ id: string; name: string; version: string; type: string }>;
        dependencyTrees: Array<{
          root: {
            package: { name: string; version: string; type?: string };
            dependencies: Array<unknown>;
          };
        }>;
        failedPackages: Array<{ name: string; version: string; error: string }>;
      };

      let data: DependencyResolveResponse;

      // 개발 환경: HTTP API 사용, 프로덕션: Electron IPC 사용
      if (isDevelopment) {
        const response = await fetch('/api/dependency/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages, options }),
        });

        if (!response.ok) {
          throw new Error('의존성 해결 실패');
        }

        data = await response.json() as DependencyResolveResponse;
      } else {
        // 프로덕션 Electron 환경: IPC 사용
        const dependencyAPI = window.electronAPI?.dependency as DependencyAPI | undefined;
        if (!dependencyAPI?.resolve) {
          throw new Error('의존성 해결 API를 사용할 수 없습니다');
        }
        data = await dependencyAPI.resolve({ packages, options }) as DependencyResolveResponse;
      }

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

          const extractDeps = (node: DependencyNodeData, parentId: string, parentName: string) => {
            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depKey = `${depPkg.name}-${depPkg.version}`;

              // 원본 패키지가 아닌 경우에만 의존성으로 표시
              if (!originalNames.has(depKey)) {
                dependencyMap.set(depKey, { parentId, parentName });
              }

              // 재귀 호출 - 항상 루트 패키지를 부모로 유지
              extractDeps(dep, rootId, rootName);
            });
          };

          extractDeps(tree.root as DependencyNodeData, rootId, rootName);
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
          totalBytes: 0,
          speed: 0,
          isDependency: !isOriginal,
          parentId: depInfo?.parentId,
          dependencyOf: depInfo?.parentName,
        };
      });

      setItems(newItems);
      downloadItemsRef.current = newItems;

      // 실패한 의존성 해결 경고 표시
      if (data.failedPackages && data.failedPackages.length > 0) {
        data.failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }

      setDepsResolved(true);
      message.success(`의존성 확인 완료: ${totalCount}개 패키지`);
    } catch (error) {
      addLog('error', '의존성 확인 실패', String(error));
      message.error('의존성 확인 중 오류가 발생했습니다');
    } finally {
      setIsResolvingDeps(false);
    }
  };

  // 다운로드 시작
  const handleStartDownload = async () => {
    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    if (!depsResolved) {
      message.warning('먼저 의존성 확인을 진행하세요');
      return;
    }

    // 출력 폴더 검사
    const canProceed = await checkOutputPath();
    if (!canProceed) {
      return;
    }

    setIsDownloading(true);
    setIsPaused(false);
    setStartTime(Date.now());
    downloadCancelledRef.current = false;
    downloadPausedRef.current = false;
    // 히스토리 저장용 장바구니 스냅샷 저장
    cartSnapshotRef.current = [...cartItems];

    addLog('info', '다운로드 시작', `총 ${downloadItems.length}개 패키지`);

    // 개발 환경 감지: Vite 개발 서버가 실행 중이면 HTTP/SSE API 사용
    const isDevelopment = import.meta.env.DEV;

    // 개발 환경에서는 HTTP/SSE API 사용 (Electron, 브라우저 모두)
    // 프로덕션에서만 Electron IPC 사용
    if (isDevelopment || !window.electronAPI?.download?.start) {
      await browserDownload();
    } else {
      // 프로덕션 Electron 환경: IPC 사용
      try {
        // 의존성 해결된 downloadItems 사용 (cartItems가 아닌)
        const packages = downloadItems.map((item: DownloadItem) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          version: item.version,
          architecture: (item as unknown as { arch?: string }).arch,
          // OS 패키지용 필드
          downloadUrl: (item as unknown as { downloadUrl?: string }).downloadUrl,
          repository: (item as unknown as { repository?: string }).repository,
          location: (item as unknown as { location?: string }).location,
          // Docker 레지스트리 등 추가 메타데이터
          metadata: (item as unknown as { metadata?: unknown }).metadata,
        }));

        const options = {
          outputDir,
          outputFormat,
          includeScripts: includeInstallScripts,
          targetOS: defaultTargetOS,
          architecture: defaultArchitecture,
          includeDependencies,
          pythonVersion: languageVersions.python,
        };

        await window.electronAPI.download.start({ packages, options });
      } catch (error) {
        addLog('error', '다운로드 시작 실패', String(error));
        setIsDownloading(false);
      }
    }
  };

  // 브라우저 환경에서 실제 다운로드 (Vite 서버 API 사용)
  const browserDownload = async () => {
    const clientId = `download-${Date.now()}`;
    clientIdRef.current = clientId;  // ref에 저장

    // SSE 연결로 진행률 수신
    const eventSource = new EventSource(`/api/download/events?clientId=${clientId}`);
    eventSourceRef.current = eventSource;  // ref에 저장

    // SSE 연결이 열릴 때까지 대기
    await new Promise<void>((resolve, reject) => {
      eventSource.onopen = () => {
        addLog('info', 'SSE 연결 성공');
        resolve();
      };
      eventSource.onerror = (e) => {
        reject(new Error('SSE 연결 실패'));
      };
      // 타임아웃 (5초)
      setTimeout(() => reject(new Error('SSE 연결 타임아웃')), 5000);
    });

    // 상태 이벤트 핸들러 (resolving, downloading)
    eventSource.addEventListener('status', (event) => {
      const data = JSON.parse(event.data) as {
        phase: string;
        message: string;
      };

      if (data.phase === 'resolving') {
        addLog('info', '의존성 분석 중...');
      } else if (data.phase === 'downloading') {
        addLog('info', '다운로드 시작...');
      }
    });

    // 의존성 해결 완료 이벤트 핸들러
    eventSource.addEventListener('deps-resolved', (event) => {
      interface DependencyNodeData {
        package: { name: string; version: string; type?: string };
        dependencies: DependencyNodeData[];
      }
      interface DependencyTreeData {
        root: DependencyNodeData;
      }

      const data = JSON.parse(event.data) as {
        originalPackages: Array<{ id: string; name: string; version: string; type: string }>;
        allPackages: Array<{ id: string; name: string; version: string; type: string }>;
        dependencyTrees: DependencyTreeData[];
        failedPackages: Array<{ name: string; version: string; error: string }>;
      };

      const originalCount = data.originalPackages.length;
      const totalCount = data.allPackages.length;

      addLog('info', `의존성 해결 완료: ${originalCount}개 → ${totalCount}개 패키지`);

      // 의존성 관계 맵 생성: packageId -> { parentId, parentName }
      const dependencyMap = new Map<string, { parentId: string; parentName: string }>();
      const originalIds = new Set(data.originalPackages.map(p => p.id));

      // 의존성 트리에서 관계 추출
      if (data.dependencyTrees) {
        data.dependencyTrees.forEach((tree) => {
          const rootPkg = tree.root.package;
          const rootId = `${rootPkg.type || 'pip'}-${rootPkg.name}-${rootPkg.version}`;
          const rootName = rootPkg.name;

          // 재귀적으로 의존성 노드 탐색
          const extractDeps = (node: DependencyNodeData, parentId: string, parentName: string) => {
            node.dependencies.forEach((dep) => {
              const depPkg = dep.package;
              const depId = `${depPkg.type || 'pip'}-${depPkg.name}-${depPkg.version}`;

              // 원본 패키지가 아닌 경우에만 의존성으로 표시
              if (!originalIds.has(depId)) {
                dependencyMap.set(depId, { parentId, parentName });
              }

              // 재귀 호출 (이 의존성의 하위 의존성들)
              extractDeps(dep, rootId, rootName);
            });
          };

          extractDeps(tree.root, rootId, rootName);
        });
      }

      // 의존성 포함된 새로운 아이템 목록으로 업데이트
      const newItems: DownloadItem[] = data.allPackages.map((pkg) => {
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
        };
      });
      setItems(newItems);
      // ref도 업데이트하여 progress 이벤트에서 최신 아이템 참조 가능
      downloadItemsRef.current = newItems;

      // 실패한 의존성 해결 경고 표시
      if (data.failedPackages && data.failedPackages.length > 0) {
        data.failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name} (v${failed.version})`, failed.error);
        });
      }
    });

    eventSource.addEventListener('progress', (event) => {
      const data = JSON.parse(event.data) as {
        packageId: string;
        status: string;
        progress: number;
        downloadedBytes?: number;
        totalBytes?: number;
        speed?: number;
        error?: string;
      };

      updateItem(data.packageId, {
        status: data.status as DownloadStatus,
        progress: data.progress,
        downloadedBytes: data.downloadedBytes || 0,
        totalBytes: data.totalBytes || 0,
        speed: data.speed || 0,
        error: data.error,
        endTime: data.status === 'completed' || data.status === 'failed' ? Date.now() : undefined,
      });

      // downloadItemsRef에서 현재 패키지 정보 조회하여 사용자 친화적인 이름 표시
      // (클로저 문제로 downloadItems 대신 ref 사용)
      const currentItem = downloadItemsRef.current.find(item => item.id === data.packageId);
      const displayName = currentItem
        ? `${currentItem.name} (v${currentItem.version})`
        : data.packageId;

      if (data.status === 'downloading' && data.progress === 0) {
        addLog('info', `다운로드 시작: ${displayName}`);
      } else if (data.status === 'completed') {
        addLog('success', `다운로드 완료: ${displayName}`);
      } else if (data.status === 'failed') {
        addLog('error', `다운로드 실패: ${displayName}`, data.error);
      }
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data) as {
        success: boolean;
        outputPath: string;
      };

      // 전체 완료 시 pending/downloading 상태인 아이템만 completed로 변경
      // (failed, skipped 등 다른 상태는 보존)
      // Zustand 스토어에서 직접 최신 상태를 가져옴 (SSE 이벤트 처리 타이밍 문제 해결)
      const currentItems = useDownloadStore.getState().items;
      currentItems.forEach((item) => {
        if (item.status === 'downloading' || item.status === 'pending') {
          updateItem(item.id, { status: 'completed', progress: 100 });
        }
      });

      setIsDownloading(false);
      setPackagingStatus('completed');
      setPackagingProgress(100);
      addLog('success', '다운로드 및 패키징 완료', `다운로드 경로: ${data.outputPath}`);
      message.success('다운로드 및 패키징이 완료되었습니다');

      // 히스토리 저장
      const finalItems = useDownloadStore.getState().items;
      const settings = useSettingsStore.getState();

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
      const historySettings: HistorySettings = {
        outputFormat: settings.defaultOutputFormat,
        includeScripts: settings.includeInstallScripts,
        includeDependencies: settings.includeDependencies,
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
        // 클로저 문제 방지를 위해 스토어에서 직접 호출
        useCartStore.getState().clearCart();
      }

      eventSource.close();
      eventSourceRef.current = null;
    });

    // 취소 이벤트 핸들러
    eventSource.addEventListener('cancelled', () => {
      addLog('warn', '다운로드가 취소되었습니다');
      setIsDownloading(false);
      setPackagingStatus('idle');
      eventSource.close();
      eventSourceRef.current = null;
    });

    // 에러 핸들러 재설정 (연결 후 에러용)
    eventSource.onerror = () => {
      addLog('error', 'SSE 연결 오류');
      setIsDownloading(false);
      eventSource.close();
      eventSourceRef.current = null;
    };

    // 다운로드 시작 요청
    try {
      // 이미 의존성 확인에서 해결된 패키지 목록 사용 (downloadItems)
      const packages = downloadItems.map((item) => {
        // 원본 장바구니에서 추가 정보 가져오기
        const cartItem = cartItems.find(c => c.id === item.id);
        return {
          id: item.id,
          type: item.type,
          name: item.name,
          version: item.version,
          architecture: cartItem?.arch,
          // OS 패키지용 필드
          downloadUrl: cartItem?.downloadUrl,
          repository: cartItem?.repository,
          location: cartItem?.location,
          // 의존성 정보
          isDependency: item.isDependency,
          parentId: item.parentId,
        };
      });

      const options = {
        outputDir,
        outputFormat,
        includeScripts: includeInstallScripts,
        targetOS: defaultTargetOS,
        architecture: defaultArchitecture,
        // 의존성은 이미 해결됨 - 다운로드 시에는 해결 안 함
        includeDependencies: false,
        pythonVersion: languageVersions.python,
        concurrency: concurrentDownloads,
        // 의존성이 이미 해결되었음을 표시
        skipDependencyResolution: true,
      };

      const response = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages, options, clientId }),
      });

      if (!response.ok) {
        throw new Error('다운로드 시작 실패');
      }
    } catch (error) {
      addLog('error', '다운로드 시작 실패', String(error));
      setIsDownloading(false);
      eventSource.close();
    }
  };;;

  // 일시정지/재개
  const handlePauseResume = () => {
    if (isPaused) {
      downloadPausedRef.current = false;
      setIsPaused(false);
      addLog('info', '다운로드 재개');
    } else {
      downloadPausedRef.current = true;
      setIsPaused(true);
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

        // 개발 환경에서 HTTP API로 취소 요청
        const isDevelopment = import.meta.env.DEV;

        if (isDevelopment || !window.electronAPI?.download?.cancel) {
          // 백엔드에 취소 요청
          try {
            const response = await fetch('/api/download/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: clientIdRef.current }),
            });

            if (response.ok) {
              addLog('info', '다운로드 취소 요청 전송됨');
            }
          } catch (error) {
            console.error('Failed to cancel download:', error);
          }

          // SSE 연결 종료
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        } else {
          // 프로덕션 Electron 환경: IPC 사용
          await window.electronAPI.download.cancel?.();
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

  // 에러 모달 - 재시도
  const handleRetry = () => {
    if (errorItem) {
      retryItem(errorItem.id);
      addLog('info', `재시도: ${errorItem.name}`);
    }
    setErrorModalOpen(false);
    setErrorItem(null);
  };

  // 에러 모달 - 건너뛰기
  const handleSkip = () => {
    if (errorItem) {
      skipItem(errorItem.id);
      addLog('warn', `건너뜀: ${errorItem.name}`);
    }
    setErrorModalOpen(false);
    setErrorItem(null);
  };

  // 에러 모달 - 취소
  const handleCancelFromError = () => {
    setErrorModalOpen(false);
    setErrorItem(null);
    handleCancelDownload();
  };

  // 완료 후 초기화 (장바구니는 유지, 다운로드 상태만 초기화)
  const handleComplete = () => {
    reset();
    setDepsResolved(false);
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
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ marginLeft: 8 }}>
            {record.version}
          </Text>
          {record.type && (
            <Tag style={{ marginLeft: 8 }}>{record.type}</Tag>
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
      title: '속도',
      dataIndex: 'speed',
      key: 'speed',
      width: 120,
      render: (speed: number, record: DownloadItem) => {
        if (record.status !== 'downloading') return '-';
        if (speed > 1024 * 1024) {
          return `${(speed / 1024 / 1024).toFixed(1)} MB/s`;
        }
        return `${(speed / 1024).toFixed(1)} KB/s`;
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
              onClick={() => {
                retryItem(record.id);
                addLog('info', `재시도 예약: ${record.name}`);
              }}
            >
              재시도
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // 전체 진행률 계산
  const totalProgress =
    downloadItems.length > 0
      ? downloadItems.reduce((sum, item) => sum + item.progress, 0) / downloadItems.length
      : 0;

  const completedCount = downloadItems.filter((item) => item.status === 'completed').length;
  const failedCount = downloadItems.filter((item) => item.status === 'failed').length;
  const skippedCount = downloadItems.filter((item) => item.status === 'skipped').length;
  const allCompleted =
    downloadItems.length > 0 &&
    downloadItems.every((item) => ['completed', 'skipped'].includes(item.status));
  const hasAnyCompleted = completedCount > 0;

  // 현재 다운로드 속도 합계
  const totalSpeed = downloadItems
    .filter((item) => item.status === 'downloading')
    .reduce((sum, item) => sum + item.speed, 0);

  // 원본 패키지와 의존성 패키지 분류
  const originalPackages = downloadItems.filter((item) => !item.isDependency);
  const dependencyPackages = downloadItems.filter((item) => item.isDependency);

  // 원본 패키지별로 의존성 그룹화
  const getPackageDependencies = (parentId: string) => {
    return dependencyPackages.filter((item) => item.parentId === parentId);
  };

  // 패키지별 진행률 계산 (자신 + 의존성 포함)
  const getPackageGroupProgress = (parentItem: DownloadItem) => {
    const deps = getPackageDependencies(parentItem.id);
    const allItems = [parentItem, ...deps];
    const totalProgress = allItems.reduce((sum, item) => sum + item.progress, 0);
    return allItems.length > 0 ? totalProgress / allItems.length : 0;
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
                title="상태"
                value={isPaused ? '일시정지' : '다운로드 중'}
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

        {/* 의존성 확인 완료 후 Collapse 트리 구조로, 미완료 시 기본 Table로 표시 */}
        {depsResolved ? (
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
              const groupProgress = getPackageGroupProgress(pkg);
              const groupStatus = getPackageGroupStatus(pkg);

              return (
                <Panel
                  key={pkg.id}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
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
                      <Space style={{ marginRight: 24 }}>
                        {groupStatus.hasFailures && (
                          <Tag color="error">{groupStatus.failed} 실패</Tag>
                        )}
                        <Tag color={groupStatus.isAllCompleted ? 'success' : 'processing'}>
                          {groupStatus.completed}/{groupStatus.total} 완료
                        </Tag>
                        <Progress
                          percent={Math.round(groupProgress)}
                          size="small"
                          style={{ width: 100, marginBottom: 0 }}
                          status={
                            groupStatus.hasFailures
                              ? 'exception'
                              : groupStatus.isAllCompleted
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
                                  onClick={() => {
                                    retryItem(dep.id);
                                    addLog('info', `재시도 예약: ${dep.name}`);
                                  }}
                                >
                                  재시도
                                </Button>
                              )}
                            </Space>
                          }
                        >
                          <Space>
                            {statusIcons[dep.status]}
                            <Text>{dep.name}</Text>
                            <Text type="secondary">{dep.version}</Text>
                            <Tag color={statusColors[dep.status]} style={{ marginLeft: 4 }}>
                              {statusLabels[dep.status]}
                            </Tag>
                          </Space>
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
          {!isDownloading && !allCompleted && !depsResolved && (
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
          {!isDownloading && !allCompleted && depsResolved && (
            <>
              <Button
                icon={<SearchOutlined />}
                size="large"
                onClick={() => {
                  setDepsResolved(false);
                  // 기존 아이템을 원본 장바구니로 초기화
                  const items: DownloadItem[] = cartItems.map((item) => ({
                    id: item.id,
                    name: item.name,
                    version: item.version,
                    type: item.type,
                    status: 'pending' as DownloadStatus,
                    progress: 0,
                    downloadedBytes: 0,
                    totalBytes: 0,
                    speed: 0,
                  }));
                  setItems(items);
                  addLog('info', '의존성 확인 초기화');
                }}
              >
                다시 확인
              </Button>
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

      {/* 에러 처리 모달 */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            다운로드 오류
          </Space>
        }
        open={errorModalOpen}
        footer={null}
        onCancel={() => setErrorModalOpen(false)}
      >
        {errorItem && (
          <>
            <Alert
              message={`${errorItem.name}@${errorItem.version} 다운로드 실패`}
              description={errorItem.error}
              type="error"
              showIcon
              style={{ marginBottom: 24 }}
            />
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleCancelFromError}>전체 취소</Button>
              <Button onClick={handleSkip}>건너뛰기</Button>
              <Button type="primary" onClick={handleRetry}>
                재시도
              </Button>
            </Space>
          </>
        )}
      </Modal>
    </div>
  );
};

export default DownloadPage;
