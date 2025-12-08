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
  Alert,
  Tag,
  Divider,
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
    includeDependencies,
    defaultOutputFormat,
    includeInstallScripts,
    enableFileSplit,
    maxFileSize,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    languageVersions,
    defaultTargetOS,
    defaultArchitecture,
    condaChannel,
    yumDistribution,
    aptDistribution,
    apkDistribution,
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
      includeDependencies,
      defaultOutputFormat,
      includeInstallScripts,
      enableFileSplit,
      maxFileSize,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFrom,
      languageVersions,
      defaultTargetOS,
      defaultArchitecture,
      condaChannel,
      // OS 배포판은 "id|architecture" 문자열 형식으로 저장
      yumDistribution: `${yumDistribution?.id}|${yumDistribution?.architecture}`,
      aptDistribution: `${aptDistribution?.id}|${aptDistribution?.architecture}`,
      apkDistribution: `${apkDistribution?.id}|${apkDistribution?.architecture}`,
    });
  }, [
    form,
    concurrentDownloads,
    enableCache,
    cachePath,
    includeDependencies,
    defaultOutputFormat,
    includeInstallScripts,
    enableFileSplit,
    maxFileSize,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    languageVersions,
    defaultTargetOS,
    defaultArchitecture,
    condaChannel,
    yumDistribution,
    aptDistribution,
    apkDistribution,
  ]);

  // 저장
  const handleSave = (values: Record<string, unknown>) => {
    // OS 배포판 문자열("id|architecture")을 객체로 변환
    const convertedValues = { ...values };

    if (typeof values.yumDistribution === 'string') {
      const [id, architecture] = (values.yumDistribution as string).split('|');
      convertedValues.yumDistribution = { id, architecture };
    }

    if (typeof values.aptDistribution === 'string') {
      const [id, architecture] = (values.aptDistribution as string).split('|');
      convertedValues.aptDistribution = { id, architecture };
    }

    if (typeof values.apkDistribution === 'string') {
      const [id, architecture] = (values.apkDistribution as string).split('|');
      convertedValues.apkDistribution = { id, architecture };
    }

    updateSettings(convertedValues);
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

        {/* 기본 언어 버전 설정 */}
        <Card title="기본 언어 버전" style={{ marginBottom: 24 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            패키지 검색 시 기본으로 선택될 언어/런타임 버전입니다.
          </Text>

          <Form.Item
            name={['languageVersions', 'python']}
            label="Python 버전"
            tooltip="pip/conda 패키지 검색 시 기본 Python 버전"
          >
            <Select>
              <Select.Option value="3.13">Python 3.13</Select.Option>
              <Select.Option value="3.12">Python 3.12</Select.Option>
              <Select.Option value="3.11">Python 3.11</Select.Option>
              <Select.Option value="3.10">Python 3.10</Select.Option>
              <Select.Option value="3.9">Python 3.9</Select.Option>
              <Select.Option value="3.8">Python 3.8 (EOL)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name={['languageVersions', 'java']}
            label="Java 버전"
            tooltip="Maven/Gradle 패키지 검색 시 기본 Java 버전"
          >
            <Select>
              <Select.Option value="21">Java 21 (LTS)</Select.Option>
              <Select.Option value="17">Java 17 (LTS)</Select.Option>
              <Select.Option value="11">Java 11 (LTS)</Select.Option>
              <Select.Option value="8">Java 8 (LTS)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name={['languageVersions', 'node']}
            label="Node.js 버전"
            tooltip="npm 패키지 검색 시 기본 Node.js 버전"
          >
            <Select>
              <Select.Option value="22">Node.js 22 (Current)</Select.Option>
              <Select.Option value="20">Node.js 20 (LTS)</Select.Option>
              <Select.Option value="18">Node.js 18 (LTS)</Select.Option>
              <Select.Option value="16">Node.js 16 (EOL)</Select.Option>
            </Select>
          </Form.Item>

          <Divider />

          <Form.Item
            name="condaChannel"
            label="Conda 채널"
            tooltip="Conda 패키지 검색 시 사용할 채널"
          >
            <Select>
              <Select.Option value="conda-forge">
                <Space>
                  <span>conda-forge</span>
                  <Tag color="green">가장 많은 패키지, 커뮤니티 관리</Tag>
                </Space>
              </Select.Option>
              <Select.Option value="anaconda">
                <Space>
                  <span>anaconda</span>
                  <Tag color="blue">Anaconda 공식 채널</Tag>
                </Space>
              </Select.Option>
              <Select.Option value="bioconda">
                <Space>
                  <span>bioconda</span>
                  <Tag color="purple">생명과학/바이오인포매틱스</Tag>
                </Space>
              </Select.Option>
              <Select.Option value="pytorch">
                <Space>
                  <span>pytorch</span>
                  <Tag color="orange">PyTorch 공식 채널</Tag>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>
        </Card>

        {/* 라이브러리 대상 환경 설정 */}
        <Card
          title="라이브러리 대상 환경 (폐쇄망 OS)"
          style={{ marginBottom: 24 }}
          extra={<Tag color="blue">pip/conda/Maven/npm</Tag>}
        >
          <Alert
            message="폐쇄망의 운영체제에 맞게 설정하세요"
            description="이 설정은 라이브러리 패키지(pip 휠, conda, Maven JAR, npm)에 적용됩니다.
            폐쇄망에 설치된 OS와 CPU 아키텍처에 맞는 바이너리를 다운로드합니다."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            name="defaultTargetOS"
            label="폐쇄망 운영체제"
            tooltip="폐쇄망에 설치된 운영체제를 선택하세요. pip/conda 휠 파일의 플랫폼 태그에 적용됩니다."
          >
            <Select>
              <Select.Option value="windows">
                <Space>
                  <span>Windows</span>
                  <Tag color="cyan">win_amd64, win32</Tag>
                </Space>
              </Select.Option>
              <Select.Option value="macos">
                <Space>
                  <span>macOS (Darwin)</span>
                  <Tag color="purple">macosx</Tag>
                </Space>
              </Select.Option>
              <Select.Option value="linux">
                <Space>
                  <span>Linux</span>
                  <Tag color="green">manylinux</Tag>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="defaultArchitecture"
            label="폐쇄망 CPU 아키텍처"
            tooltip="폐쇄망 시스템의 CPU 아키텍처를 선택하세요"
          >
            <Select>
              <Select.Option value="x86_64">x86_64 (64비트 Intel/AMD - 가장 일반적)</Select.Option>
              <Select.Option value="amd64">amd64 (x86_64와 동일)</Select.Option>
              <Select.Option value="arm64">ARM64 (Apple Silicon, AWS Graviton)</Select.Option>
              <Select.Option value="aarch64">aarch64 (arm64와 동일)</Select.Option>
              <Select.Option value="noarch">noarch (아키텍처 무관)</Select.Option>
            </Select>
          </Form.Item>

        </Card>

        {/* OS 패키지 배포판 설정 */}
        <Card
          title="OS 패키지 배포판 설정"
          style={{ marginBottom: 24 }}
          extra={<Tag color="orange">YUM/APT/APK</Tag>}
        >
          <Alert
            message="OS 패키지 검색 시 사용할 배포판"
            description="각 패키지 관리자별로 검색할 배포판과 아키텍처를 설정합니다. 폐쇄망의 OS 버전에 맞게 설정하세요."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            name="yumDistribution"
            label="YUM 배포판 (RHEL 계열)"
            tooltip="YUM 패키지 검색 시 사용할 배포판과 아키텍처"
          >
            <Select>
              <Select.OptGroup label="Rocky Linux">
                <Select.Option value="rocky-9|x86_64">Rocky Linux 9 (x86_64)</Select.Option>
                <Select.Option value="rocky-9|aarch64">Rocky Linux 9 (aarch64)</Select.Option>
                <Select.Option value="rocky-8|x86_64">Rocky Linux 8 (x86_64)</Select.Option>
                <Select.Option value="rocky-8|aarch64">Rocky Linux 8 (aarch64)</Select.Option>
              </Select.OptGroup>
              <Select.OptGroup label="AlmaLinux">
                <Select.Option value="almalinux-9|x86_64">AlmaLinux 9 (x86_64)</Select.Option>
                <Select.Option value="almalinux-9|aarch64">AlmaLinux 9 (aarch64)</Select.Option>
                <Select.Option value="almalinux-8|x86_64">AlmaLinux 8 (x86_64)</Select.Option>
                <Select.Option value="almalinux-8|aarch64">AlmaLinux 8 (aarch64)</Select.Option>
              </Select.OptGroup>
              <Select.OptGroup label="CentOS (EOL)">
                <Select.Option value="centos-7|x86_64">CentOS 7 (x86_64) - EOL</Select.Option>
              </Select.OptGroup>
            </Select>
          </Form.Item>

          <Form.Item
            name="aptDistribution"
            label="APT 배포판 (Debian/Ubuntu 계열)"
            tooltip="APT 패키지 검색 시 사용할 배포판과 아키텍처"
          >
            <Select>
              <Select.OptGroup label="Ubuntu LTS">
                <Select.Option value="ubuntu-24.04|amd64">Ubuntu 24.04 LTS (amd64)</Select.Option>
                <Select.Option value="ubuntu-24.04|arm64">Ubuntu 24.04 LTS (arm64)</Select.Option>
                <Select.Option value="ubuntu-22.04|amd64">Ubuntu 22.04 LTS (amd64)</Select.Option>
                <Select.Option value="ubuntu-22.04|arm64">Ubuntu 22.04 LTS (arm64)</Select.Option>
                <Select.Option value="ubuntu-20.04|amd64">Ubuntu 20.04 LTS (amd64)</Select.Option>
                <Select.Option value="ubuntu-20.04|arm64">Ubuntu 20.04 LTS (arm64)</Select.Option>
              </Select.OptGroup>
              <Select.OptGroup label="Debian">
                <Select.Option value="debian-12|amd64">Debian 12 Bookworm (amd64)</Select.Option>
                <Select.Option value="debian-12|arm64">Debian 12 Bookworm (arm64)</Select.Option>
                <Select.Option value="debian-11|amd64">Debian 11 Bullseye (amd64)</Select.Option>
                <Select.Option value="debian-11|arm64">Debian 11 Bullseye (arm64)</Select.Option>
              </Select.OptGroup>
            </Select>
          </Form.Item>

          <Form.Item
            name="apkDistribution"
            label="APK 배포판 (Alpine Linux)"
            tooltip="APK 패키지 검색 시 사용할 배포판과 아키텍처"
          >
            <Select>
              <Select.Option value="alpine-3.20|x86_64">Alpine 3.20 (x86_64)</Select.Option>
              <Select.Option value="alpine-3.20|aarch64">Alpine 3.20 (aarch64)</Select.Option>
              <Select.Option value="alpine-3.18|x86_64">Alpine 3.18 (x86_64)</Select.Option>
              <Select.Option value="alpine-3.18|aarch64">Alpine 3.18 (aarch64)</Select.Option>
            </Select>
          </Form.Item>
        </Card>

        {/* 의존성 설정 */}
        <Card title="의존성 설정" style={{ marginBottom: 24 }}>
          <Form.Item
            name="includeDependencies"
            label="의존성 자동 포함 다운로드"
            valuePropName="checked"
            tooltip="패키지 다운로드 시 전이적 의존성을 자동으로 해결하여 함께 다운로드합니다"
          >
            <Switch />
          </Form.Item>
          <Text type="secondary">
            활성화 시 패키지의 모든 의존성을 자동으로 분석하여 함께 다운로드합니다.
            폐쇄망 환경에서 설치 시 필요한 모든 파일을 한 번에 준비할 수 있습니다.
          </Text>
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
          <Alert
            message="다운로드 시 자동 적용"
            description="여기서 설정한 출력 형식과 설치 스크립트 옵션이 모든 다운로드에 자동으로 적용됩니다."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            name="defaultOutputFormat"
            label="기본 출력 형식"
            tooltip="다운로드 완료 시 기본 출력 형식"
          >
            <Select>
              <Select.Option value="zip">ZIP 압축 (메일 첨부에 적합)</Select.Option>
              <Select.Option value="tar.gz">TAR.GZ 압축 (Linux 환경에 적합)</Select.Option>
              <Select.Option value="mirror">오프라인 미러 구조 (로컬 저장소 사용)</Select.Option>
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
