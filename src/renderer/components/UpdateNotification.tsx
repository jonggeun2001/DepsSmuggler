import { useEffect, useState, useCallback } from 'react';
import { Modal, Button, Progress, Typography, Space, message } from 'antd';
import { SyncOutlined, DownloadOutlined, ReloadOutlined, CloseOutlined } from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
  progress: ProgressInfo | null;
  updateInfo: UpdateInfo | null;
}

export function UpdateNotification() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [visible, setVisible] = useState(false);

  // 상태 업데이트 리스너
  useEffect(() => {
    if (!window.electronAPI?.updater) return;

    const unsubscribe = window.electronAPI.updater.onStatusChange((newStatus) => {
      const s = newStatus as UpdateStatus;
      setStatus(s);

      // 새 버전 발견 시 모달 표시
      if (s.available && !s.downloaded && !s.downloading) {
        setVisible(true);
      }

      // 다운로드 완료 시 모달 표시
      if (s.downloaded) {
        setVisible(true);
      }

      // 에러 시 메시지 표시
      if (s.error) {
        message.error(`업데이트 오류: ${s.error}`);
      }
    });

    // 초기 상태 로드
    window.electronAPI.updater.getStatus().then((s) => {
      setStatus(s as UpdateStatus);
    });

    return unsubscribe;
  }, []);

  // 업데이트 다운로드
  const handleDownload = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    const result = await window.electronAPI.updater.download();
    if (!result.success) {
      message.error(`다운로드 실패: ${result.error}`);
    }
  }, []);

  // 설치 및 재시작
  const handleInstall = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    await window.electronAPI.updater.install();
  }, []);

  // 나중에 설치
  const handleLater = useCallback(() => {
    setVisible(false);
    message.info('앱 종료 시 자동으로 업데이트가 설치됩니다.');
  }, []);

  // 닫기
  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  // 바이트 포맷
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Electron 환경이 아니면 렌더링하지 않음
  if (!window.electronAPI?.updater) {
    return null;
  }

  if (!status) return null;

  // 체크 중
  if (status.checking) {
    return (
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
        <Button icon={<SyncOutlined spin />} disabled>
          업데이트 확인 중...
        </Button>
      </div>
    );
  }

  return (
    <Modal
      title={
        <Space>
          {status.downloaded ? (
            <ReloadOutlined style={{ color: '#52c41a' }} />
          ) : (
            <DownloadOutlined style={{ color: '#1890ff' }} />
          )}
          <span>{status.downloaded ? '업데이트 준비 완료' : '새 버전 발견'}</span>
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      footer={null}
      closable={!status.downloading}
      maskClosable={!status.downloading}
    >
      {status.updateInfo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <Title level={4}>v{status.updateInfo.version}</Title>

          <Text type="secondary">
            릴리즈 날짜: {new Date(status.updateInfo.releaseDate).toLocaleDateString('ko-KR')}
          </Text>

          {status.updateInfo.releaseNotes && (
            <Paragraph
              style={{
                maxHeight: 150,
                overflow: 'auto',
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
              }}
            >
              {status.updateInfo.releaseNotes}
            </Paragraph>
          )}

          {/* 다운로드 진행률 */}
          {status.downloading && status.progress && (
            <div style={{ marginTop: 16 }}>
              <Progress
                percent={Math.round(status.progress.percent)}
                status="active"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatBytes(status.progress.transferred)} / {formatBytes(status.progress.total)}
                {' | '}
                {formatBytes(status.progress.bytesPerSecond)}/s
              </Text>
            </div>
          )}

          {/* 버튼 */}
          <Space style={{ marginTop: 16, width: '100%', justifyContent: 'flex-end' }}>
            {!status.downloaded && !status.downloading && (
              <>
                <Button onClick={handleClose} icon={<CloseOutlined />}>
                  나중에
                </Button>
                <Button type="primary" onClick={handleDownload} icon={<DownloadOutlined />}>
                  다운로드
                </Button>
              </>
            )}

            {status.downloading && (
              <Button disabled loading>
                다운로드 중...
              </Button>
            )}

            {status.downloaded && (
              <>
                <Button onClick={handleLater}>
                  나중에 설치
                </Button>
                <Button type="primary" onClick={handleInstall} icon={<ReloadOutlined />}>
                  지금 재시작
                </Button>
              </>
            )}
          </Space>
        </div>
      )}
    </Modal>
  );
}
