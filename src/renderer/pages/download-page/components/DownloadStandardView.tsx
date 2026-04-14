import {
  CaretRightOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PauseOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Progress,
  Radio,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { DownloadItemsTable } from './DownloadItemsTable';
import { DownloadLogsCard } from './DownloadLogsCard';
import { formatBytes } from '../utils';
import type { DownloadItem, LogEntry, PackagingStatus } from '../../../stores/download-store';

const { Title, Text } = Typography;

interface DownloadStandardViewProps {
  outputDir: string;
  onOutputDirChange: (value: string) => void;
  deliveryMethod: 'local' | 'email';
  onDeliveryMethodChange: (value: 'local' | 'email') => void;
  effectiveSmtpTo: string;
  outputFormat: 'zip' | 'tar.gz';
  fileSplitEnabled: boolean;
  maxFileSizeMB: number;
  isDownloading: boolean;
  onSelectFolder: () => Promise<void> | void;
  downloadItems: DownloadItem[];
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  totalDownloadedBytes: number;
  totalExpectedBytes: number;
  totalProgress: number;
  isPaused: boolean;
  packagingStatus: PackagingStatus;
  packagingProgress: number;
  totalSpeed: number;
  remainingTime: string | null;
  includeDependencies: boolean;
  depsResolved: boolean;
  isResolvingDeps: boolean;
  allCompleted: boolean;
  logs: LogEntry[];
  onRetry: (item: DownloadItem) => void;
  onResolveDependencies: () => Promise<void> | void;
  onResetDependencies: () => void;
  onStartDownload: () => Promise<void> | void;
  onPauseResume: () => Promise<void> | void;
  onCancelDownload: () => void;
  onComplete: () => void;
}

export function DownloadStandardView({
  outputDir,
  onOutputDirChange,
  deliveryMethod,
  onDeliveryMethodChange,
  effectiveSmtpTo,
  outputFormat,
  fileSplitEnabled,
  maxFileSizeMB,
  isDownloading,
  onSelectFolder,
  downloadItems,
  completedCount,
  failedCount,
  skippedCount,
  totalDownloadedBytes,
  totalExpectedBytes,
  totalProgress,
  isPaused,
  packagingStatus,
  packagingProgress,
  totalSpeed,
  remainingTime,
  includeDependencies,
  depsResolved,
  isResolvingDeps,
  allCompleted,
  logs,
  onRetry,
  onResolveDependencies,
  onResetDependencies,
  onStartDownload,
  onPauseResume,
  onCancelDownload,
  onComplete,
}: DownloadStandardViewProps) {
  return (
    <div>
      <Title level={3}>다운로드</Title>

      <Card title="다운로드 경로" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong>다운로드 폴더</Text>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={outputDir}
              onChange={(e) => onOutputDirChange(e.target.value)}
              placeholder="다운로드 폴더 경로"
              disabled={isDownloading}
            />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={onSelectFolder}
              disabled={isDownloading}
            >
              선택
            </Button>
          </Space.Compact>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong>출력 형식</Text>
          <div style={{ marginTop: 8 }}>
            <Tag color="blue">{outputFormat.toUpperCase()}</Tag>
          </div>
        </div>

        <div>
          <Text strong>전달 방식</Text>
          <Radio.Group
            value={deliveryMethod}
            onChange={(event) => onDeliveryMethodChange(event.target.value)}
            disabled={isDownloading}
            style={{ display: 'block', marginTop: 8 }}
          >
            <Space direction="vertical">
              <Radio value="local">로컬 저장만</Radio>
              <Radio value="email">이메일로 전달</Radio>
            </Space>
          </Radio.Group>
          {deliveryMethod === 'email' && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="설정 화면의 SMTP 발신자/수신자와 파일 분할 값을 사용합니다."
              description={(
                <Space direction="vertical" size={4}>
                  <Text>
                    {effectiveSmtpTo
                      ? `현재 수신자: ${effectiveSmtpTo}`
                      : '현재 수신자: 없음 (설정 화면에서 SMTP 수신자를 먼저 입력하세요.)'}
                  </Text>
                  <Text>
                    파일 분할: {fileSplitEnabled ? '활성' : '비활성'}
                  </Text>
                  <Text>
                    {fileSplitEnabled
                      ? `${maxFileSizeMB}MB 초과 시 자동 분할하여 첨부 제한에 맞춰 전달합니다.`
                      : `자동 분할 비활성: ${maxFileSizeMB}MB 기준을 초과하면 이메일 전달이 실패할 수 있습니다.`}
                  </Text>
                </Space>
              )}
            />
          )}
        </div>
      </Card>

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
                value={remainingTime || '-'}
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

        {packagingStatus === 'packaging' && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>패키징 진행 중...</Text>
            <Progress percent={packagingProgress} status="active" />
          </div>
        )}

        <DownloadItemsTable
          downloadItems={downloadItems}
          showDependenciesTree={includeDependencies && depsResolved}
          onRetry={onRetry}
          paginate
        />
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <Space>
          {includeDependencies && !isDownloading && !allCompleted && !depsResolved && (
            <Button
              type="primary"
              icon={isResolvingDeps ? <LoadingOutlined /> : <SearchOutlined />}
              size="large"
              onClick={onResolveDependencies}
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
                  onClick={onResetDependencies}
                >
                  다시 확인
                </Button>
              )}
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                size="large"
                onClick={onStartDownload}
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
                onClick={onPauseResume}
              >
                {isPaused ? '재개' : '일시정지'}
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                size="large"
                onClick={onCancelDownload}
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
              onClick={onComplete}
            >
              완료
            </Button>
          )}
        </Space>
      </Card>

      <DownloadLogsCard logs={logs} style={{ marginTop: 16 }} />
    </div>
  );
}
