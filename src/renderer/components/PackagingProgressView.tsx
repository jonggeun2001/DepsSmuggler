import { LoadingOutlined } from '@ant-design/icons';
import { Progress, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { formatBytes } from '../pages/download-page/utils';
import type { PackagingDetails } from '../../types/packaging';

export function PackagingProgressView({ message, archiveProgress }: PackagingDetails) {
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <section aria-label="파일 생성 진행" aria-busy="true" style={{ marginBottom: 16 }}>
      <Space>
        <LoadingOutlined aria-hidden="true" />
        <Typography.Text strong role="status">
          {message}
        </Typography.Text>
      </Space>
      <div>
        <Typography.Text type="secondary">
          다운로드 후 파일을 준비하고 있습니다. 경과 시간 {elapsed}초
        </Typography.Text>
      </div>
      {archiveProgress && (
        <>
          <Progress percent={Math.floor(archiveProgress.percentage)} status="active" />
          <Typography.Text type="secondary">
            {archiveProgress.processedFiles} / {archiveProgress.totalFiles}개 파일 처리
            {' · '}압축 파일{' '}
            {archiveProgress.outputBytes ? formatBytes(archiveProgress.outputBytes) : '0 B'} 기록
          </Typography.Text>
        </>
      )}
    </section>
  );
}
