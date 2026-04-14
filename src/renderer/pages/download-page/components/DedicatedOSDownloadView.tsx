import { FolderOpenOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { OSDownloadProgress, OSDownloadResult, OSPackageCart } from '../../../components/os';
import type {
  OSPackageInfo,
  OSPackageOutputOptions,
  OSDistribution,
  OSDownloadProgress as OSDownloadProgressData,
} from '../../../../core/downloaders/os-shared/types';
import type { OSDownloadResultData } from '../types';

const { Title, Text } = Typography;

interface DedicatedOSDownloadViewProps {
  outputDir: string;
  onOutputDirChange: (value: string) => void;
  onSelectFolder: () => Promise<void> | void;
  osDownloadError: string | null;
  osResult: OSDownloadResultData | null;
  osProgress: OSDownloadProgressData | null;
  osPackages: OSPackageInfo[];
  osDistribution: OSDistribution | null;
  historyOSOutputOptions?: OSPackageOutputOptions;
  osDownloading: boolean;
  isOSPackaging: boolean;
  onCancelOSDownload: () => void;
  onStartOSDownload: (outputOptions: OSPackageOutputOptions) => Promise<void>;
  onOpenFolder: () => Promise<void> | void;
  onComplete: () => void;
  onRemoveOSPackage: (pkg: OSPackageInfo) => void;
  onClearCart: () => void;
}

export function DedicatedOSDownloadView({
  outputDir,
  onOutputDirChange,
  onSelectFolder,
  osDownloadError,
  osResult,
  osProgress,
  osPackages,
  osDistribution,
  historyOSOutputOptions,
  osDownloading,
  isOSPackaging,
  onCancelOSDownload,
  onStartOSDownload,
  onOpenFolder,
  onComplete,
  onRemoveOSPackage,
  onClearCart,
}: DedicatedOSDownloadViewProps) {
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
            onChange={(e) => onOutputDirChange(e.target.value)}
            placeholder="다운로드 폴더 경로"
            disabled={osDownloading}
          />
          <Button
            icon={<FolderOpenOutlined />}
            onClick={onSelectFolder}
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
          onOpenFolder={onOpenFolder}
          onClose={onComplete}
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
              onClick={onCancelOSDownload}
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
          onRemovePackage={onRemoveOSPackage}
          onClearAll={onClearCart}
          onStartDownload={onStartOSDownload}
        />
      )}
    </div>
  );
}
