import { SyncOutlined, DownloadOutlined, ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import { Modal, Button, Progress, Typography, Space, message } from 'antd';
import { useEffect, useState, useCallback } from 'react';
import { ReleaseNotes } from './ReleaseNotes';
import type { UpdateReleaseNotes } from '../../types/updater';

const { Text, Title } = Typography;

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: UpdateReleaseNotes;
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

    let disposed = false;
    let receivedStatusEvent = false;
    const applyStatus = (s: UpdateStatus, initial = false) => {
      if (disposed) return;
      setStatus(s);

      // 구독 전에 발견된 업데이트와 진행 중인 다운로드도 초기 조회로 복원한다.
      if (
        (s.available && !s.downloaded && !s.downloading) ||
        s.downloaded ||
        (initial && s.downloading)
      ) {
        setVisible(true);
      }

      // 에러 시 메시지 표시
      if (s.error) {
        message.error(`업데이트 오류: ${s.error}`);
      }
    };

    const unsubscribe = window.electronAPI.updater.onStatusChange((newStatus) => {
      receivedStatusEvent = true;
      applyStatus(newStatus as UpdateStatus);
    });

    // 늦게 도착한 초기 응답이 최신 이벤트(및 사용자의 닫기 선택)를 덮지 않게 한다.
    void window.electronAPI.updater
      .getStatus()
      .then((s) => {
        if (!receivedStatusEvent) applyStatus(s as UpdateStatus, true);
      })
      .catch(() => {
        if (!disposed && !receivedStatusEvent) {
          message.error('업데이트 상태를 불러오지 못했습니다. 설정에서 다시 확인해 주세요.');
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
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

          <Text strong>릴리스 이력</Text>
          <ReleaseNotes
            releaseNotes={status.updateInfo.releaseNotes}
            version={status.updateInfo.version}
          />

          {/* 다운로드 진행률 */}
          {status.downloading && status.progress && (
            <div style={{ marginTop: 16 }}>
              <Progress percent={Math.round(status.progress.percent)} status="active" />
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
                <Button onClick={handleLater}>나중에 설치</Button>
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
