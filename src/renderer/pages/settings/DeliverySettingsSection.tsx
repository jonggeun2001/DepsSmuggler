import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd';
import React from 'react';
import {
  SETTINGS_CARD_BODY_PADDING,
  SETTINGS_CARD_MARGIN,
  type SmtpTestMode,
} from './settings-form-utils';

const { Text } = Typography;

interface DeliverySettingsSectionProps {
  onSelectDownloadFolder: () => Promise<void>;
  onTestSmtp: () => Promise<void>;
  smtpTestMode: SmtpTestMode;
  smtpTestModeMessage: string;
  smtpTestResult: 'success' | 'failed' | null;
  testingSmtp: boolean;
}

export const DeliverySettingsSection: React.FC<DeliverySettingsSectionProps> = ({
  onSelectDownloadFolder,
  onTestSmtp,
  smtpTestMode,
  smtpTestModeMessage,
  smtpTestResult,
  testingSmtp,
}) => {
  const smtpAlertType: 'info' | 'warning' =
    smtpTestMode === 'missing-ipc' ? 'warning' : 'info';
  const smtpButtonLabel =
    smtpTestMode === 'browser-simulated' ? '연결 테스트 (시뮬레이션)' : '연결 테스트';

  return (
    <>
      <Card
        title="전달 및 출력 설정"
        size="small"
        style={{ marginBottom: SETTINGS_CARD_MARGIN }}
        styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="defaultDownloadPath"
              label="기본 다운로드 경로"
              tooltip="다운로드 파일이 저장될 기본 경로 (비워두면 시스템 기본 다운로드 폴더 사용)"
              style={{ marginBottom: 8 }}
            >
              <Input.Search
                placeholder="다운로드 경로를 선택하세요"
                enterButton={<FolderOpenOutlined />}
                onSearch={() => void onSelectDownloadFolder()}
                readOnly
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="defaultOutputFormat"
              label="출력 형식"
              style={{ marginBottom: 8 }}
            >
              <Select size="small">
                <Select.Option value="zip">ZIP</Select.Option>
                <Select.Option value="tar.gz">TAR.GZ</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="includeInstallScripts"
              label="설치 스크립트"
              valuePropName="checked"
              tooltip="bash/PowerShell 스크립트 생성"
              style={{ marginBottom: 0 }}
            >
              <Switch size="small" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="enableFileSplit"
              label="파일 분할"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch size="small" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="maxFileSize"
          label="최대 크기 (MB)"
          tooltip="이메일 첨부 제한"
          style={{ marginTop: 8, marginBottom: 0 }}
        >
          <InputNumber size="small" min={1} max={1000} style={{ width: '100%' }} />
        </Form.Item>
      </Card>

      <Card
        title={
          <Space>
            <span>SMTP 설정</span>
            <Tooltip title="다운로드한 패키지를 이메일로 직접 발송">
              <InfoCircleOutlined style={{ color: '#999' }} />
            </Tooltip>
          </Space>
        }
        size="small"
        style={{ marginBottom: SETTINGS_CARD_MARGIN }}
        styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
      >
        {smtpTestMode !== 'ipc' && (
          <Alert
            type={smtpAlertType}
            showIcon
            message={smtpTestModeMessage}
            style={{ marginBottom: 12 }}
          />
        )}

        <Row gutter={8}>
          <Col span={12}>
            <Form.Item name="smtpHost" label="SMTP 서버" style={{ marginBottom: 8 }}>
              <Input size="small" placeholder="smtp.example.com" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="smtpPort" label="포트" style={{ marginBottom: 8 }}>
              <InputNumber
                size="small"
                min={1}
                max={65535}
                style={{ width: '100%' }}
                placeholder="587"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="smtpFrom" label="발신자" style={{ marginBottom: 8 }}>
              <Input size="small" placeholder="noreply@..." />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={12}>
            <Form.Item name="smtpUser" label="사용자명" style={{ marginBottom: 8 }}>
              <Input size="small" placeholder="user@example.com" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="smtpPassword" label="비밀번호" style={{ marginBottom: 8 }}>
              <Input.Password size="small" placeholder="••••••••" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={24}>
            <Form.Item name="smtpTo" label="수신자" style={{ marginBottom: 8 }}>
              <Input size="small" placeholder="offline@example.com" />
            </Form.Item>
          </Col>
        </Row>

        <Space size={8}>
          <Button
            size="small"
            icon={<SendOutlined />}
            onClick={() => void onTestSmtp()}
            loading={testingSmtp}
            disabled={smtpTestMode === 'missing-ipc'}
          >
            {smtpButtonLabel}
          </Button>
          {smtpTestResult === 'success' && (
            <Text type="success" style={{ fontSize: 12 }}>
              <CheckCircleOutlined /> 성공
            </Text>
          )}
          {smtpTestResult === 'failed' && (
            <Text type="danger" style={{ fontSize: 12 }}>
              <CloseCircleOutlined /> 실패
            </Text>
          )}
        </Space>
      </Card>
    </>
  );
};
