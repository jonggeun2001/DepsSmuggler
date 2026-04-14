import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ForwardOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PauseOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type {
  DownloadStatus,
  LogEntry,
} from '../../stores/download-store';
import type { ReactNode } from 'react';

export const statusIcons: Record<DownloadStatus, ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
  downloading: <LoadingOutlined spin style={{ color: '#1890ff' }} />,
  completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  failed: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  cancelled: <StopOutlined style={{ color: '#faad14' }} />,
  skipped: <ForwardOutlined style={{ color: '#faad14' }} />,
  paused: <PauseOutlined style={{ color: '#1890ff' }} />,
};

export const statusLabels: Record<DownloadStatus, string> = {
  pending: '대기',
  downloading: '다운로드 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
  skipped: '건너뜀',
  paused: '일시정지',
};

export const statusColors: Record<DownloadStatus, string> = {
  pending: 'default',
  downloading: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  skipped: 'warning',
  paused: 'processing',
};

export const logIcons: Record<LogEntry['level'], ReactNode> = {
  info: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
  warn: <WarningOutlined style={{ color: '#faad14' }} />,
  error: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  success: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
};
