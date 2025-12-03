import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  InputNumber,
  Switch,
  Input,
  Select,
  Button,
  Typography,
  Space,
  message,
  Statistic,
  Row,
  Col,
  Popconfirm,
  Spin,
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  SendOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '../stores/settingsStore';

const { Title, Text } = Typography;

const SettingsPage: React.FC = () => {
  const {
    concurrentDownloads,
    enableCache,
    cachePath,
    defaultOutputFormat,
    includeInstallScripts,
    enableFileSplit,
    maxFileSize,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    updateSettings,
    resetSettings,
  } = useSettingsStore();

  const [form] = Form.useForm();

  // 캐시 상태
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [cacheCount, setCacheCount] = useState<number>(0);
  const [loadingCache, setLoadingCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // SMTP 테스트 상태
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<'success' | 'failed' | null>(null);

  // 캐시 정보 로드
  const loadCacheInfo = async () => {
    setLoadingCache(true);
    try {
      // IPC를 통해 캐시 정보 조회
      if (window.electronAPI?.getCacheStats) {
        const stats = await window.electronAPI.getCacheStats();
        setCacheSize(stats.totalSize);
        setCacheCount(stats.entryCount);
      } else {
        // 개발 환경 시뮬레이션
        setCacheSize(256 * 1024 * 1024); // 256MB
        setCacheCount(12);
      }
    } catch (error) {
      console.error('캐시 정보 로드 실패:', error);
    } finally {
      setLoadingCache(false);
    }
  };

  // 캐시 삭제
  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      if (window.electronAPI?.clearCache) {
        await window.electronAPI.clearCache();
      }
      setCacheSize(0);
      setCacheCount(0);
      message.success('캐시가 삭제되었습니다');
    } catch (error) {
      message.error('캐시 삭제에 실패했습니다');
    } finally {
      setClearingCache(false);
    }
  };

  // SMTP 연결 테스트
  const handleTestSmtp = async () => {
    const values = form.getFieldsValue();
    if (!values.smtpHost || !values.smtpPort) {
      message.warning('SMTP 서버와 포트를 입력하세요');
      return;
    }

    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      if (window.electronAPI?.testSmtpConnection) {
        const result = await window.electronAPI.testSmtpConnection({
          host: values.smtpHost,
          port: values.smtpPort,
          user: values.smtpUser,
          password: values.smtpPassword,
        });
        setSmtpTestResult(result ? 'success' : 'failed');
        if (result) {
          message.success('SMTP 연결 테스트 성공');
        } else {
          message.error('SMTP 연결 테스트 실패');
        }
      } else {
        // 개발 환경 시뮬레이션
        await new Promise(resolve => setTimeout(resolve, 1500));
        setSmtpTestResult('success');
        message.success('SMTP 연결 테스트 성공 (시뮬레이션)');
      }
    } catch (error) {
      setSmtpTestResult('failed');
      message.error('SMTP 연결 테스트 실패');
    } finally {
      setTestingSmtp(false);
    }
  };

  // 바이트 포맷
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 컴포넌트 마운트 시 캐시 정보 로드
  useEffect(() => {
    loadCacheInfo();
  }, []);

  // 초기값 설정
  React.useEffect(() => {
    form.setFieldsValue({
      concurrentDownloads,
      enableCache,
      cachePath,
      defaultOutputFormat,
      includeInstallScripts,
      enableFileSplit,
      maxFileSize,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFrom,
    });
  }, [
    form,
    concurrentDownloads,
    enableCache,
    cachePath,
    defaultOutputFormat,
    includeInstallScripts,
    enableFileSplit,
    maxFileSize,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
  ]);

  // 저장
  const handleSave = (values: Record<string, unknown>) => {
    updateSettings(values);
    message.success('설정이 저장되었습니다');
  };

  // 초기화
  const handleReset = () => {
    resetSettings();
    form.resetFields();
    message.info('설정이 초기화되었습니다');
  };

  // 폴더 선택
  const handleSelectFolder = () => {
    // TODO: Electron IPC로 폴더 선택
    message.info('폴더 선택 기능은 Electron 환경에서 사용 가능합니다');
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          설정
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            초기화
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => form.submit()}
          >
            저장
          </Button>
        </Space>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        style={{ maxWidth: 600 }}
      >
        {/* 다운로드 설정 */}
        <Card title="다운로드 설정" style={{ marginBottom: 24 }}>
          <Form.Item
            name="concurrentDownloads"
            label="동시 다운로드 수"
            tooltip="동시에 다운로드할 수 있는 최대 파일 수"
          >
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Card>

        {/* 캐시 설정 */}
        <Card title="캐시 설정" style={{ marginBottom: 24 }}>
          <Form.Item
            name="enableCache"
            label="캐시 사용"
            valuePropName="checked"
            tooltip="다운로드한 패키지를 캐시하여 재사용"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="cachePath"
            label="캐시 경로"
            tooltip="패키지 캐시 저장 위치"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="cachePath" noStyle>
                <Input placeholder="~/.depssmuggler/cache" />
              </Form.Item>
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectFolder}>
                선택
              </Button>
            </Space.Compact>
          </Form.Item>

          {/* 캐시 통계 */}
          <div style={{ marginTop: 16, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong style={{ display: 'block', marginBottom: 12 }}>캐시 현황</Text>
            <Spin spinning={loadingCache}>
              <Row gutter={24}>
                <Col span={12}>
                  <Statistic
                    title="캐시 크기"
                    value={formatBytes(cacheSize)}
                    valueStyle={{ fontSize: 18 }}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="캐시된 패키지"
                    value={cacheCount}
                    suffix="개"
                    valueStyle={{ fontSize: 18 }}
                  />
                </Col>
              </Row>
            </Spin>
            <div style={{ marginTop: 16 }}>
              <Space>
                <Button onClick={loadCacheInfo} loading={loadingCache}>
                  새로고침
                </Button>
                <Popconfirm
                  title="캐시 삭제"
                  description="모든 캐시된 패키지가 삭제됩니다. 계속하시겠습니까?"
                  onConfirm={handleClearCache}
                  okText="삭제"
                  cancelText="취소"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={clearingCache}
                    disabled={cacheSize === 0}
                  >
                    캐시 삭제
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          </div>
        </Card>

        {/* 출력 설정 */}
        <Card title="출력 설정" style={{ marginBottom: 24 }}>
          <Form.Item
            name="defaultOutputFormat"
            label="기본 출력 형식"
            tooltip="다운로드 완료 시 기본 출력 형식"
          >
            <Select>
              <Select.Option value="zip">ZIP 압축</Select.Option>
              <Select.Option value="tar.gz">TAR.GZ 압축</Select.Option>
              <Select.Option value="mirror">오프라인 미러 구조</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="includeInstallScripts"
            label="설치 스크립트 포함"
            valuePropName="checked"
            tooltip="bash/PowerShell 설치 스크립트 생성"
          >
            <Switch />
          </Form.Item>
        </Card>

        {/* 파일 분할 설정 */}
        <Card title="파일 분할 설정" style={{ marginBottom: 24 }}>
          <Form.Item
            name="enableFileSplit"
            label="파일 분할 사용"
            valuePropName="checked"
            tooltip="대용량 파일을 작은 파일로 분할"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="maxFileSize"
            label="최대 파일 크기 (MB)"
            tooltip="이메일 첨부 제한 등을 고려한 최대 파일 크기"
          >
            <InputNumber
              min={1}
              max={1000}
              style={{ width: '100%' }}
              formatter={(value) => `${value} MB`}
              parser={(value) => value?.replace(' MB', '') as unknown as number}
            />
          </Form.Item>
        </Card>

        {/* SMTP 설정 */}
        <Card title="SMTP 설정 (메일 발송)" style={{ marginBottom: 24 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            다운로드한 패키지를 이메일로 직접 발송할 수 있습니다.
          </Text>

          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="smtpHost" label="SMTP 서버">
                <Input placeholder="smtp.example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="smtpPort" label="포트">
                <InputNumber
                  min={1}
                  max={65535}
                  style={{ width: '100%' }}
                  placeholder="587"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="smtpUser" label="사용자명">
            <Input placeholder="user@example.com" />
          </Form.Item>

          <Form.Item name="smtpPassword" label="비밀번호">
            <Input.Password placeholder="••••••••" />
          </Form.Item>

          <Form.Item name="smtpFrom" label="발신자 주소">
            <Input placeholder="noreply@example.com" />
          </Form.Item>

          {/* SMTP 연결 테스트 */}
          <div style={{ marginTop: 8 }}>
            <Space>
              <Button
                icon={<SendOutlined />}
                onClick={handleTestSmtp}
                loading={testingSmtp}
              >
                연결 테스트
              </Button>
              {smtpTestResult === 'success' && (
                <Text type="success">
                  <CheckCircleOutlined /> 연결 성공
                </Text>
              )}
              {smtpTestResult === 'failed' && (
                <Text type="danger">
                  <CloseCircleOutlined /> 연결 실패
                </Text>
              )}
            </Space>
          </div>
        </Card>
      </Form>
    </div>
  );
};

export default SettingsPage;
