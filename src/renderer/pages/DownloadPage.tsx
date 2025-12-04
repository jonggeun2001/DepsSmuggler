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
} from '@ant-design/icons';
import { useCartStore } from '../stores/cartStore';
import {
  useDownloadStore,
  DownloadItem,
  DownloadStatus,
  LogEntry,
} from '../stores/downloadStore';
import { useSettingsStore } from '../stores/settingsStore';

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
  const {
    items: downloadItems,
    isDownloading,
    isPaused,
    outputPath,
    outputFormat,
    packagingStatus,
    packagingProgress,
    logs,
    startTime,
    setItems,
    updateItem,
    setIsDownloading,
    setIsPaused,
    setOutputPath,
    setOutputFormat,
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

  const [outputDir, setOutputDir] = useState(outputPath || '');
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorItem, setErrorItem] = useState<DownloadItem | null>(null);
  const downloadCancelledRef = useRef(false);
  const downloadPausedRef = useRef(false);

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

    if (!outputFormat) {
      setOutputFormat(defaultOutputFormat);
    }
  }, [cartItems, downloadItems.length, setItems, outputFormat, setOutputFormat, defaultOutputFormat, clearLogs]);

  // IPC 이벤트 리스너 설정
  useEffect(() => {
    if (!window.electronAPI?.download) return;

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
      addLog('success', `다운로드 완료: ${downloadItems.find(i => i.id === r.id)?.name}`);
    });

    const unsubError = window.electronAPI.download.onError((error: unknown) => {
      const e = error as { id: string; message: string };
      const item = downloadItems.find(i => i.id === e.id);
      if (item) {
        updateItem(e.id, { status: 'failed', error: e.message });
        setErrorItem({ ...item, error: e.message });
        setErrorModalOpen(true);
        addLog('error', `다운로드 실패: ${item.name}`, e.message);
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
      const originalCount = data.originalPackages.length;
      const totalCount = data.allPackages.length;

      addLog(
        'info',
        `의존성 해결 완료: ${originalCount}개 → ${totalCount}개 패키지`
      );

      // 의존성 포함된 새로운 아이템 목록으로 업데이트
      if (totalCount > originalCount) {
        const newItems: DownloadItem[] = (data.allPackages as Array<{
          id: string;
          name: string;
          version: string;
          type: string;
        }>).map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          type: pkg.type,
          status: 'pending' as DownloadStatus,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          speed: 0,
        }));
        setItems(newItems);
      }

      // 실패한 의존성 해결 경고 표시
      if (data.failedPackages && data.failedPackages.length > 0) {
        data.failedPackages.forEach((failed) => {
          addLog('warn', `의존성 해결 실패: ${failed.name}@${failed.version}`, failed.error);
        });
      }
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
      unsubStatus?.();
      unsubDepsResolved?.();
    };
  }, [downloadItems, updateItem, addLog, setItems]);

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
      addLog('info', `개발 환경 출력 경로: ${devOutputPath}`);
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

  // 다운로드 시작
  const handleStartDownload = async () => {
    if (!outputDir) {
      message.warning('출력 폴더를 선택하세요');
      return;
    }

    setIsDownloading(true);
    setIsPaused(false);
    setStartTime(Date.now());
    downloadCancelledRef.current = false;
    downloadPausedRef.current = false;

    addLog('info', '다운로드 시작', `총 ${downloadItems.length}개 패키지`);

    // 실제 Electron IPC 호출 또는 Mock 다운로드
    if (window.electronAPI?.download?.start) {
      try {
        // 패키지 데이터와 옵션을 전달
        const packages = cartItems.map(item => ({
          id: item.id,
          type: item.type,
          name: item.name,
          version: item.version,
          architecture: item.arch,
        }));

        const options = {
          outputDir,
          outputFormat,
          includeScripts,
        };

        // 진행률 이벤트 리스너 설정
        const unsubProgress = window.electronAPI.download.onProgress((data: {
          packageId: string;
          status: string;
          progress: number;
          downloadedBytes?: number;
          totalBytes?: number;
          speed?: number;
          error?: string;
        }) => {
          const item = downloadItems.find(i => i.id === data.packageId);
          if (item) {
            updateItem(data.packageId, {
              status: data.status as DownloadStatus,
              progress: data.progress,
              downloadedBytes: data.downloadedBytes || 0,
              totalBytes: data.totalBytes || 0,
              speed: data.speed || 0,
              error: data.error,
              endTime: data.status === 'completed' || data.status === 'failed' ? Date.now() : undefined,
            });

            if (data.status === 'downloading' && data.progress === 0) {
              addLog('info', `다운로드 시작: ${item.name}@${item.version}`);
            } else if (data.status === 'completed') {
              addLog('success', `다운로드 완료: ${item.name}@${item.version}`);
            } else if (data.status === 'failed') {
              addLog('error', `다운로드 실패: ${item.name}@${item.version}`, data.error);
            }
          }
        });

        // 완료 이벤트 리스너 설정
        const unsubComplete = window.electronAPI.download.onComplete((result: {
          success: boolean;
          outputPath: string;
        }) => {
          setIsDownloading(false);
          setPackagingStatus('completed');
          setPackagingProgress(100);
          addLog('success', '다운로드 및 패키징 완료', `출력 경로: ${result.outputPath}`);
          message.success('다운로드 및 패키징이 완료되었습니다');
        });

        // 에러 이벤트 리스너 설정
        const unsubError = window.electronAPI.download.onError((error: { message: string }) => {
          addLog('error', '다운로드 오류', error.message);
        });

        await window.electronAPI.download.start({ packages, options });

        // 리스너 정리는 컴포넌트 언마운트 시 처리
      } catch (error) {
        addLog('error', '다운로드 시작 실패', String(error));
        setIsDownloading(false);
      }
    } else {
      // 브라우저 환경: Vite 서버 API 호출
      await browserDownload();
    }
  };

  // 브라우저 환경에서 실제 다운로드 (Vite 서버 API 사용)
  const browserDownload = async () => {
    const clientId = `download-${Date.now()}`;

    // SSE 연결로 진행률 수신
    const eventSource = new EventSource(`/api/download/events?clientId=${clientId}`);

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

      const item = downloadItems.find((i) => i.id === data.packageId);
      if (item) {
        updateItem(data.packageId, {
          status: data.status as DownloadStatus,
          progress: data.progress,
          downloadedBytes: data.downloadedBytes || 0,
          totalBytes: data.totalBytes || 0,
          speed: data.speed || 0,
          error: data.error,
          endTime: data.status === 'completed' || data.status === 'failed' ? Date.now() : undefined,
        });

        if (data.status === 'downloading' && data.progress === 0) {
          addLog('info', `다운로드 시작: ${item.name}@${item.version}`);
        } else if (data.status === 'completed') {
          addLog('success', `다운로드 완료: ${item.name}@${item.version}`);
        } else if (data.status === 'failed') {
          addLog('error', `다운로드 실패: ${item.name}@${item.version}`, data.error);
        }
      }
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data) as {
        success: boolean;
        outputPath: string;
      };

      setIsDownloading(false);
      setPackagingStatus('completed');
      setPackagingProgress(100);
      addLog('success', '다운로드 및 패키징 완료', `출력 경로: ${data.outputPath}`);
      message.success('다운로드 및 패키징이 완료되었습니다');
      eventSource.close();
    });

    eventSource.onerror = () => {
      addLog('error', 'SSE 연결 오류');
      eventSource.close();
    };

    // 다운로드 시작 요청
    try {
      const packages = cartItems.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
      }));

      const options = {
        outputDir,
        outputFormat,
        includeScripts,
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
  };

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
      onOk: () => {
        downloadCancelledRef.current = true;
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

  // 완료 후 초기화
  const handleComplete = () => {
    clearCart();
    reset();
    navigate('/');
    message.success('완료되었습니다');
  };

  // 출력 폴더 열기
  const handleOpenFolder = () => {
    // TODO: Electron shell.openPath 호출
    message.info(`폴더 열기: ${outputDir}`);
    addLog('info', `폴더 열기: ${outputDir}`);
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
              출력 폴더 열기
            </Button>,
            <Button key="done" onClick={handleComplete}>
              완료
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
            <Text strong>출력 경로:</Text>
            <Paragraph copyable style={{ marginTop: 8 }}>
              {outputDir}
            </Paragraph>
          </div>
        </Card>

        {/* 로그 */}
        <Collapse style={{ marginTop: 24 }}>
          <Panel header={`로그 (${logs.length}개)`} key="logs">
            <List
              size="small"
              dataSource={logs}
              renderItem={(log) => (
                <List.Item>
                  <Space>
                    {logIcons[log.level]}
                    <Text type="secondary">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </Text>
                    <Text>{log.message}</Text>
                    {log.details && (
                      <Text type="secondary">- {log.details}</Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          </Panel>
        </Collapse>
      </div>
    );
  }

  return (
    <div>
      <Title level={3}>다운로드</Title>

      {/* 출력 설정 */}
      <Card title="출력 설정" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong>출력 폴더</Text>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="출력 폴더 경로"
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

        <div style={{ marginBottom: 16 }}>
          <Text strong>출력 형식</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              disabled={isDownloading}
            >
              <Radio.Button value="zip">ZIP 압축</Radio.Button>
              <Radio.Button value="tar.gz">TAR.GZ 압축</Radio.Button>
              <Radio.Button value="mirror">미러 구조</Radio.Button>
            </Radio.Group>
          </div>
        </div>

        {includeInstallScripts && (
          <Alert
            message="설치 스크립트 포함"
            description="bash (install.sh) 및 PowerShell (install.ps1) 스크립트가 포함됩니다."
            type="info"
            showIcon
          />
        )}
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

        <Table
          columns={columns}
          dataSource={downloadItems}
          rowKey="id"
          pagination={downloadItems.length > 10 ? { pageSize: 10 } : false}
          size="small"
        />
      </Card>

      {/* 액션 버튼 */}
      <Card style={{ marginBottom: 24 }}>
        <Space>
          {!isDownloading && !allCompleted && (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              size="large"
              onClick={handleStartDownload}
              disabled={!outputDir}
            >
              다운로드 시작
            </Button>
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
          {allCompleted && (
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
      <Collapse>
        <Panel
          header={
            <Space>
              <span>로그</span>
              <Tag>{logs.length}개</Tag>
            </Space>
          }
          key="logs"
        >
          <List
            size="small"
            dataSource={logs.slice(-50).reverse()}
            locale={{ emptyText: '로그가 없습니다' }}
            renderItem={(log) => (
              <List.Item>
                <Space>
                  {logIcons[log.level]}
                  <Text type="secondary" style={{ minWidth: 80 }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text>{log.message}</Text>
                  {log.details && (
                    <Text type="secondary">- {log.details}</Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </Panel>
      </Collapse>

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
