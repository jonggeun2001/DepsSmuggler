import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  ForwardOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Divider, Result, Row, Statistic, Typography } from 'antd';
import { DownloadItemsTable } from './DownloadItemsTable';
import { DownloadLogsCard } from './DownloadLogsCard';
import type { HistoryDeliveryResult } from '../../../../types';
import type { DownloadItem, LogEntry } from '../../../stores/download-store';

const { Text, Paragraph } = Typography;

interface DownloadOutcomeViewProps {
  variant: 'completed' | 'failed';
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  outputFormat: 'zip' | 'tar.gz';
  deliveryMethod: 'local' | 'email';
  completedOutputPath: string;
  outputDir: string;
  completedArtifactPaths: string[];
  completedDeliveryResult?: HistoryDeliveryResult;
  completedError: string;
  downloadItems: DownloadItem[];
  logs: LogEntry[];
  onRetry: (item: DownloadItem) => void;
  onOpenFolder: () => Promise<void> | void;
  onComplete: () => void;
}

export function DownloadOutcomeView({
  variant,
  completedCount,
  failedCount,
  skippedCount,
  outputFormat,
  deliveryMethod,
  completedOutputPath,
  outputDir,
  completedArtifactPaths,
  completedDeliveryResult,
  completedError,
  downloadItems,
  logs,
  onRetry,
  onOpenFolder,
  onComplete,
}: DownloadOutcomeViewProps) {
  const isCompleted = variant === 'completed';

  return (
    <div>
      <Result
        status={isCompleted ? (failedCount > 0 ? 'warning' : 'success') : 'error'}
        title={
          isCompleted
            ? failedCount > 0
              ? '부분 완료'
              : '다운로드 완료'
            : completedArtifactPaths.length > 0
            ? '전달 실패'
            : '다운로드 실패'
        }
        subTitle={
          isCompleted
            ? failedCount > 0
              ? `${completedCount}개 패키지가 완료되었고 ${failedCount}개는 실패했습니다. 생성된 산출물을 확인하세요.`
              : `${completedCount}개 패키지가 성공적으로 다운로드되었습니다`
            : completedArtifactPaths.length > 0
            ? '로컬 산출물은 생성되었습니다. 경로를 확인해 수동 전달을 진행할 수 있습니다.'
            : '패키징 또는 전달 중 오류가 발생했습니다.'
        }
        extra={[
          <Button
            type="primary"
            key="open"
            icon={<FolderOpenOutlined />}
            onClick={onOpenFolder}
          >
            다운로드 폴더 열기
          </Button>,
          <Button key="done" icon={<ReloadOutlined />} onClick={onComplete}>
            새 다운로드
          </Button>,
        ]}
      />

      <Card title={isCompleted ? '다운로드 결과' : '실패 결과'} style={{ marginTop: 24 }}>
        {!isCompleted && (
          <Alert
            type="error"
            showIcon
            message="전달 실패 상세"
            description={completedError || completedDeliveryResult?.error || '상세 오류를 확인할 수 없습니다.'}
            style={{ marginBottom: 16 }}
          />
        )}

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
          <Text strong>{isCompleted ? '다운로드 경로:' : '대표 경로:'}</Text>
          <Paragraph copyable style={{ marginTop: 8 }}>
            {completedOutputPath || outputDir}
          </Paragraph>
        </div>

        <Divider />

        <div>
          <Text strong>전달 방식:</Text>
          <Paragraph style={{ marginTop: 8 }}>
            {deliveryMethod === 'email' ? '이메일 전달' : '로컬 저장'}
          </Paragraph>
        </div>

        {completedArtifactPaths.length > 0 && (
          <div>
            <Text strong>{isCompleted ? '실제 산출물:' : '복구 가능한 산출물:'}</Text>
            <div style={{ marginTop: 8 }}>
              {completedArtifactPaths.map((artifactPath) => (
                <Paragraph key={artifactPath} copyable style={{ marginBottom: 4 }}>
                  {artifactPath}
                </Paragraph>
              ))}
            </div>
          </div>
        )}

        {isCompleted && completedDeliveryResult?.emailSent && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 16 }}
            message={`이메일 전달 완료 (${completedDeliveryResult.emailsSent || 1}건)`}
            description={
              completedDeliveryResult.splitApplied
                ? '첨부 제한을 넘겨 분할 파일로 전달했습니다.'
                : '아카이브 파일을 그대로 첨부해 전달했습니다.'
            }
          />
        )}
      </Card>

      <Card title={isCompleted ? '다운로드된 패키지' : '다운로드된 패키지'} style={{ marginTop: 24 }}>
        <DownloadItemsTable
          downloadItems={downloadItems}
          showDependenciesTree={false}
          onRetry={onRetry}
          paginate={false}
        />
      </Card>

      <DownloadLogsCard logs={logs} style={{ marginTop: 24 }} />
    </div>
  );
}
