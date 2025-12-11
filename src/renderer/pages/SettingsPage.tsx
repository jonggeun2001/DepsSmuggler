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
  Tag,
  Divider,
  Tooltip,
  Alert,
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  SendOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudOutlined,
  InfoCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';

import { useSettingsStore } from '../stores/settingsStore';
import type { OSDistribution } from '../global';

// 컴팩트 레이아웃 상수
const CARD_MARGIN = 12;
const CARD_BODY_PADDING = '12px 16px';

const { Title, Text } = Typography;

const SettingsPage: React.FC = () => {
  const {
    concurrentDownloads,
    enableCache,
    cachePath,
    includeDependencies,
    defaultDownloadPath,
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
    dockerArchitecture,
    dockerLayerCompression,
    dockerIncludeLoadScript,
    autoUpdate,
    autoDownloadUpdate,
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

  // OS 배포판 목록 상태
  const [distributions, setDistributions] = useState<OSDistribution[]>([]);
  const [loadingDistributions, setLoadingDistributions] = useState(false);

  // 캐스케이드 선택을 위한 로컬 상태 (배포판 ID와 아키텍처 분리)
  const [selectedYumDistroId, setSelectedYumDistroId] = useState<string>(yumDistribution?.id || 'rocky-9');
  const [selectedAptDistroId, setSelectedAptDistroId] = useState<string>(aptDistribution?.id || 'ubuntu-22.04');
  const [selectedApkDistroId, setSelectedApkDistroId] = useState<string>(apkDistribution?.id || 'alpine-3.18');

  // 캐시 정보 로드
  const loadCacheInfo = async () => {
    setLoadingCache(true);
    try {
      // Electron 환경
      if (window.electronAPI?.cache?.getStats) {
        const stats = await window.electronAPI.cache.getStats();
        setCacheSize(stats.totalSize);
        setCacheCount(stats.entryCount);
      } else {
        // 개발 환경 - API 호출
        const response = await fetch('/api/cache/stats');
        if (response.ok) {
          const stats = await response.json();
          setCacheSize(stats.totalSize);
          setCacheCount(stats.entryCount);
        } else {
          throw new Error('Failed to fetch cache stats');
        }
      }
    } catch (error) {
      console.error('캐시 정보 로드 실패:', error);
      // 에러 시 0으로 설정
      setCacheSize(0);
      setCacheCount(0);
    } finally {
      setLoadingCache(false);
    }
  };

  // 캐시 삭제
  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      // Electron 환경
      if (window.electronAPI?.cache?.clear) {
        await window.electronAPI.cache.clear();
      } else {
        // 개발 환경 - API 호출
        const response = await fetch('/api/cache/clear', { method: 'POST' });
        if (!response.ok) {
          throw new Error('Failed to clear cache');
        }
      }
      setCacheSize(0);
      setCacheCount(0);
      message.success('캐시가 삭제되었습니다');
    } catch (error) {
      console.error('캐시 삭제 실패:', error);
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

  // OS 배포판 목록 로드
  const loadDistributions = async () => {
    setLoadingDistributions(true);
    try {
      if (window.electronAPI?.os?.getAllDistributions) {
        const data = await window.electronAPI.os.getAllDistributions() as OSDistribution[];
        setDistributions(data);
      } else {
        // 개발 환경 - API 호출
        const response = await fetch('/api/os/distributions');
        if (response.ok) {
          const data = await response.json();
          setDistributions(data);
        }
      }
    } catch (error) {
      console.error('배포판 목록 로드 실패:', error);
    } finally {
      setLoadingDistributions(false);
    }
  };

  // 컴포넌트 마운트 시 캐시 정보 및 배포판 목록 로드
  useEffect(() => {
    loadCacheInfo();
    loadDistributions();
  }, []);

  // 초기값 설정
  React.useEffect(() => {
    form.setFieldsValue({
      concurrentDownloads,
      enableCache,
      cachePath,
      includeDependencies,
      defaultDownloadPath,
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
      // OS 배포판 (2단계 캐스케이드: 배포판 ID와 아키텍처 분리)
      yumDistributionId: yumDistribution?.id || 'rocky-9',
      yumArchitecture: yumDistribution?.architecture || 'x86_64',
      aptDistributionId: aptDistribution?.id || 'ubuntu-22.04',
      aptArchitecture: aptDistribution?.architecture || 'amd64',
      apkDistributionId: apkDistribution?.id || 'alpine-3.18',
      apkArchitecture: apkDistribution?.architecture || 'x86_64',
      // Docker 설정
      dockerArchitecture,
      dockerLayerCompression,
      dockerIncludeLoadScript,
      // 자동 업데이트
      autoUpdate,
      autoDownloadUpdate,
    });
    // 로컬 상태도 업데이트
    setSelectedYumDistroId(yumDistribution?.id || 'rocky-9');
    setSelectedAptDistroId(aptDistribution?.id || 'ubuntu-22.04');
    setSelectedApkDistroId(apkDistribution?.id || 'alpine-3.18');
  }, [
    form,
    concurrentDownloads,
    enableCache,
    cachePath,
    includeDependencies,
    defaultDownloadPath,
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
    dockerArchitecture,
    dockerLayerCompression,
    dockerIncludeLoadScript,
    autoUpdate,
    autoDownloadUpdate,
  ]);

  // 저장
  const handleSave = (values: Record<string, unknown>) => {
    // OS 배포판 (2단계 캐스케이드 값을 객체로 합침)
    const convertedValues = { ...values };

    // yumDistribution 합성
    if (values.yumDistributionId && values.yumArchitecture) {
      convertedValues.yumDistribution = {
        id: values.yumDistributionId as string,
        architecture: values.yumArchitecture as string,
      };
      delete convertedValues.yumDistributionId;
      delete convertedValues.yumArchitecture;
    }

    // aptDistribution 합성
    if (values.aptDistributionId && values.aptArchitecture) {
      convertedValues.aptDistribution = {
        id: values.aptDistributionId as string,
        architecture: values.aptArchitecture as string,
      };
      delete convertedValues.aptDistributionId;
      delete convertedValues.aptArchitecture;
    }

    // apkDistribution 합성
    if (values.apkDistributionId && values.apkArchitecture) {
      convertedValues.apkDistribution = {
        id: values.apkDistributionId as string,
        architecture: values.apkArchitecture as string,
      };
      delete convertedValues.apkDistributionId;
      delete convertedValues.apkArchitecture;
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

  // 배포판 필터링 헬퍼
  const getDistributionsByManager = (packageManager: 'yum' | 'apt' | 'apk') => {
    return distributions.filter(d => d.packageManager === packageManager);
  };

  // 배포판 ID로 배포판 정보 가져오기
  const getDistributionById = (distroId: string) => {
    return distributions.find(d => d.id === distroId);
  };

  // 배포판 ID로 지원 아키텍처 목록 가져오기
  const getArchitecturesForDistro = (distroId: string, packageManager: 'yum' | 'apt' | 'apk'): string[] => {
    const distro = getDistributionById(distroId);
    if (distro) {
      return distro.architectures;
    }
    // 폴백: 기본 아키텍처
    if (packageManager === 'apt') {
      return ['amd64', 'arm64', 'i386'];
    }
    return ['x86_64', 'aarch64'];
  };

  // 배포판 그룹화 (이름으로 그룹화)
  const groupDistributions = (distros: OSDistribution[]) => {
    const groups: Record<string, OSDistribution[]> = {};
    distros.forEach(d => {
      // name에서 버전 없는 기본 이름 추출 (예: "Rocky Linux 9" -> "Rocky Linux")
      const baseName = d.name.replace(/\s*\d+(\.\d+)*\s*.*$/, '').trim() || d.name;
      if (!groups[baseName]) {
        groups[baseName] = [];
      }
      groups[baseName].push(d);
    });
    return groups;
  };

  // 배포판만 선택하는 Select 옵션 렌더링 (2단계 캐스케이드용)
  const renderDistroOnlyOptions = (packageManager: 'yum' | 'apt' | 'apk') => {
    const distros = getDistributionsByManager(packageManager);

    if (distros.length === 0) {
      // 배포판이 로드되지 않았을 때 기본값 렌더링
      return renderFallbackDistroOptions(packageManager);
    }

    const groups = groupDistributions(distros);

    return Object.entries(groups).map(([groupName, groupDistros]) => (
      <Select.OptGroup key={groupName} label={groupName}>
        {groupDistros.map(d => (
          <Select.Option key={d.id} value={d.id}>
            {d.name}
          </Select.Option>
        ))}
      </Select.OptGroup>
    ));
  };

  // 아키텍처 Select 옵션 렌더링
  const renderArchOptions = (distroId: string, packageManager: 'yum' | 'apt' | 'apk') => {
    const architectures = getArchitecturesForDistro(distroId, packageManager);
    return architectures.map(arch => (
      <Select.Option key={arch} value={arch}>
        {arch}
      </Select.Option>
    ));
  };

  // 배포판 로드 전 폴백 옵션 (배포판만)
  const renderFallbackDistroOptions = (packageManager: 'yum' | 'apt' | 'apk') => {
    if (packageManager === 'yum') {
      return (
        <>
          <Select.OptGroup label="Rocky Linux">
            <Select.Option value="rocky-9">Rocky Linux 9</Select.Option>
            <Select.Option value="rocky-8">Rocky Linux 8</Select.Option>
          </Select.OptGroup>
          <Select.OptGroup label="AlmaLinux">
            <Select.Option value="almalinux-9">AlmaLinux 9</Select.Option>
            <Select.Option value="almalinux-8">AlmaLinux 8</Select.Option>
          </Select.OptGroup>
        </>
      );
    } else if (packageManager === 'apt') {
      return (
        <>
          <Select.OptGroup label="Ubuntu">
            <Select.Option value="ubuntu-24.04">Ubuntu 24.04 LTS</Select.Option>
            <Select.Option value="ubuntu-22.04">Ubuntu 22.04 LTS</Select.Option>
            <Select.Option value="ubuntu-20.04">Ubuntu 20.04 LTS</Select.Option>
          </Select.OptGroup>
          <Select.OptGroup label="Debian">
            <Select.Option value="debian-12">Debian 12 Bookworm</Select.Option>
            <Select.Option value="debian-11">Debian 11 Bullseye</Select.Option>
          </Select.OptGroup>
        </>
      );
    } else {
      return (
        <>
          <Select.Option value="alpine-3.20">Alpine 3.20</Select.Option>
          <Select.Option value="alpine-3.18">Alpine 3.18</Select.Option>
        </>
      );
    }
  };

  // 배포판 선택 변경 핸들러
  const handleDistroChange = (
    distroId: string,
    packageManager: 'yum' | 'apt' | 'apk',
    setDistroId: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setDistroId(distroId);
    // 아키텍처를 해당 배포판의 첫 번째 지원 아키텍처로 변경
    const architectures = getArchitecturesForDistro(distroId, packageManager);
    const fieldName = `${packageManager}Architecture`;
    if (architectures.length > 0) {
      form.setFieldValue(fieldName, architectures[0]);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 70px - 48px - 48px)', // viewport - footer - margin
      margin: '-24px', // Content padding 상쇄
      overflow: 'hidden'
    }}>
      {/* 고정 헤더 */}
      <div style={{
        flexShrink: 0,
        height: 56,
        padding: '0 24px',
        borderBottom: '1px solid #f0f0f0',
        backgroundColor: '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Title level={4} style={{ margin: 0 }}>설정</Title>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>
            초기화
          </Button>
          <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => form.submit()}>
            저장
          </Button>
        </Space>
      </div>

      {/* 스크롤 가능한 콘텐츠 영역 */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px 24px'
      }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          style={{ maxWidth: 600 }}
          className="compact-settings-form"
        >
        {/* 다운로드 및 의존성 설정 통합 */}
        <Card
          title="다운로드 설정"
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="concurrentDownloads"
                label="동시 다운로드 수"
                tooltip="동시에 다운로드할 수 있는 최대 파일 수"
                style={{ marginBottom: 8 }}
              >
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="includeDependencies"
                label="의존성 자동 포함"
                valuePropName="checked"
                tooltip="패키지 다운로드 시 전이적 의존성을 함께 다운로드"
                style={{ marginBottom: 8 }}
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="defaultDownloadPath"
            label="기본 다운로드 경로"
            tooltip="다운로드 파일이 저장될 기본 경로 (비워두면 시스템 기본 다운로드 폴더 사용)"
            style={{ marginBottom: 8 }}
          >
            <Input.Search
              placeholder="다운로드 경로를 선택하세요"
              enterButton={<FolderOpenOutlined />}
              onSearch={async () => {
                if (window.electronAPI?.selectDirectory) {
                  const selectedPath = await window.electronAPI.selectDirectory();
                  if (selectedPath) {
                    form.setFieldValue('defaultDownloadPath', selectedPath);
                  }
                } else {
                  message.info('폴더 선택은 Electron 환경에서만 가능합니다');
                }
              }}
              readOnly
            />
          </Form.Item>
        </Card>

        {/* 기본 언어 버전 설정 */}
        <Card
          title={
            <Space>
              <span>기본 언어 버전</span>
              <Tooltip title="패키지 검색 시 기본으로 선택될 언어/런타임 버전입니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name={['languageVersions', 'python']}
                label="Python"
                tooltip="pip/conda"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="3.13">3.13</Select.Option>
                  <Select.Option value="3.12">3.12</Select.Option>
                  <Select.Option value="3.11">3.11</Select.Option>
                  <Select.Option value="3.10">3.10</Select.Option>
                  <Select.Option value="3.9">3.9</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name={['languageVersions', 'java']}
                label="Java"
                tooltip="Maven"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="21">21 LTS</Select.Option>
                  <Select.Option value="17">17 LTS</Select.Option>
                  <Select.Option value="11">11 LTS</Select.Option>
                  <Select.Option value="8">8 LTS</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name={['languageVersions', 'node']}
                label="Node.js"
                tooltip="npm"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="22">22</Select.Option>
                  <Select.Option value="20">20 LTS</Select.Option>
                  <Select.Option value="18">18 LTS</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="condaChannel"
            label="Conda 채널"
            style={{ marginBottom: 0 }}
          >
            <Select size="small">
              <Select.Option value="conda-forge">conda-forge (커뮤니티)</Select.Option>
              <Select.Option value="anaconda">anaconda (공식)</Select.Option>
              <Select.Option value="bioconda">bioconda (생명과학)</Select.Option>
              <Select.Option value="pytorch">pytorch</Select.Option>
            </Select>
          </Form.Item>
        </Card>

        {/* 라이브러리 대상 환경 설정 */}
        <Card
          title={
            <Space>
              <span>라이브러리 대상 환경</span>
              <Tag color="blue">pip/conda/Maven/npm</Tag>
              <Tooltip title="폐쇄망에 설치된 OS와 CPU 아키텍처에 맞는 바이너리를 다운로드합니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="defaultTargetOS"
                label="폐쇄망 OS"
                tooltip="pip/conda 휠 파일의 플랫폼 태그에 적용"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="windows">Windows</Select.Option>
                  <Select.Option value="macos">macOS</Select.Option>
                  <Select.Option value="linux">Linux</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="defaultArchitecture"
                label="CPU 아키텍처"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="x86_64">x86_64</Select.Option>
                  <Select.Option value="amd64">amd64</Select.Option>
                  <Select.Option value="arm64">ARM64</Select.Option>
                  <Select.Option value="aarch64">aarch64</Select.Option>
                  <Select.Option value="noarch">noarch</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* OS 패키지 배포판 설정 */}
        <Card
          title={
            <Space>
              <span>OS 패키지 배포판</span>
              <Tag color="orange">YUM/APT/APK</Tag>
              <Tooltip title="각 패키지 관리자별로 검색할 배포판과 아키텍처를 설정합니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          {/* YUM */}
          <Text type="secondary" style={{ fontSize: 12 }}>YUM (RHEL 계열)</Text>
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={14}>
              <Form.Item name="yumDistributionId" style={{ marginBottom: 0 }}>
                <Select
                  size="small"
                  loading={loadingDistributions}
                  onChange={(value) => handleDistroChange(value, 'yum', setSelectedYumDistroId)}
                >
                  {renderDistroOnlyOptions('yum')}
                </Select>
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="yumArchitecture" style={{ marginBottom: 0 }}>
                <Select size="small">
                  {renderArchOptions(selectedYumDistroId, 'yum')}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* APT */}
          <Text type="secondary" style={{ fontSize: 12 }}>APT (Debian/Ubuntu)</Text>
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={14}>
              <Form.Item name="aptDistributionId" style={{ marginBottom: 0 }}>
                <Select
                  size="small"
                  loading={loadingDistributions}
                  onChange={(value) => handleDistroChange(value, 'apt', setSelectedAptDistroId)}
                >
                  {renderDistroOnlyOptions('apt')}
                </Select>
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="aptArchitecture" style={{ marginBottom: 0 }}>
                <Select size="small">
                  {renderArchOptions(selectedAptDistroId, 'apt')}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* APK */}
          <Text type="secondary" style={{ fontSize: 12 }}>APK (Alpine)</Text>
          <Row gutter={8}>
            <Col span={14}>
              <Form.Item name="apkDistributionId" style={{ marginBottom: 0 }}>
                <Select
                  size="small"
                  loading={loadingDistributions}
                  onChange={(value) => handleDistroChange(value, 'apk', setSelectedApkDistroId)}
                >
                  {renderDistroOnlyOptions('apk')}
                </Select>
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="apkArchitecture" style={{ marginBottom: 0 }}>
                <Select size="small">
                  {renderArchOptions(selectedApkDistroId, 'apk')}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Docker 설정 */}
        <Card
          title={
            <Space>
              <CloudOutlined />
              <span>Docker 설정</span>
              <Tag color="geekblue">Docker</Tag>
              <Tooltip title="컨테이너 이미지를 다운로드할 때 사용할 레지스트리, 아키텍처 및 옵션">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Alert
            message="레지스트리는 패키지 검색 화면에서 선택합니다"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="dockerArchitecture"
                label="아키텍처"
                tooltip="멀티 아키텍처 이미지에서 다운로드할 플랫폼"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="amd64">amd64</Select.Option>
                  <Select.Option value="arm64">arm64</Select.Option>
                  <Select.Option value="arm/v7">arm/v7</Select.Option>
                  <Select.Option value="386">386</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dockerLayerCompression"
                label="압축"
                style={{ marginBottom: 8 }}
              >
                <Select size="small">
                  <Select.Option value="gzip">gzip</Select.Option>
                  <Select.Option value="tar">tar</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dockerIncludeLoadScript"
                label="load 스크립트"
                valuePropName="checked"
                style={{ marginBottom: 8 }}
              >
                <Switch size="small" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 캐시 설정 */}
        <Card
          title="캐시 설정"
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="enableCache"
                label="캐시 사용"
                valuePropName="checked"
                style={{ marginBottom: 8 }}
              >
                <Switch size="small" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="cachePath"
                label="캐시 경로"
                style={{ marginBottom: 8 }}
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Input size="small" placeholder="~/.depssmuggler/cache" />
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={handleSelectFolder} />
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>

          {/* 캐시 통계 (컴팩트) */}
          <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
            <Spin spinning={loadingCache}>
              <Row gutter={16} align="middle">
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>크기: </Text>
                  <Text strong style={{ fontSize: 13 }}>{formatBytes(cacheSize)}</Text>
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>패키지: </Text>
                  <Text strong style={{ fontSize: 13 }}>{cacheCount}개</Text>
                </Col>
                <Col span={8} style={{ textAlign: 'right' }}>
                  <Space size={4}>
                    <Button size="small" onClick={loadCacheInfo} loading={loadingCache}>새로고침</Button>
                    <Popconfirm
                      title="캐시 삭제"
                      description="모든 캐시가 삭제됩니다"
                      onConfirm={handleClearCache}
                      okText="삭제"
                      cancelText="취소"
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} loading={clearingCache} disabled={cacheSize === 0} />
                    </Popconfirm>
                  </Space>
                </Col>
              </Row>
            </Spin>
          </div>
        </Card>

        {/* 자동 업데이트 설정 */}
        {window.electronAPI?.updater && (
          <Card
            title="자동 업데이트"
            size="small"
            style={{ marginBottom: CARD_MARGIN }}
            styles={{ body: { padding: CARD_BODY_PADDING } }}
          >
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="autoUpdate"
                  label="자동 업데이트 확인"
                  valuePropName="checked"
                  style={{ marginBottom: 8 }}
                  tooltip="앱 시작 시 새 버전을 자동으로 확인합니다"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="autoDownloadUpdate"
                  label="자동 다운로드"
                  valuePropName="checked"
                  style={{ marginBottom: 8 }}
                  tooltip="새 버전 발견 시 자동으로 다운로드합니다"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
              <Col span={8} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  onClick={async () => {
                    if (window.electronAPI?.updater) {
                      message.loading({ content: '업데이트 확인 중...', key: 'update-check' });
                      const result = await window.electronAPI.updater.check();
                      if (result.success) {
                        message.success({ content: '업데이트 확인 완료', key: 'update-check' });
                      } else {
                        message.error({ content: `업데이트 확인 실패: ${result.error}`, key: 'update-check' });
                      }
                    }
                  }}
                >
                  지금 확인
                </Button>
              </Col>
            </Row>
          </Card>
        )}

        {/* 출력 설정 */}
        <Card
          title={
            <Space>
              <span>출력 설정</span>
              <Tooltip title="다운로드에 자동 적용됩니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
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
            <Col span={12}>
              <Form.Item
                name="includeInstallScripts"
                label="설치 스크립트"
                valuePropName="checked"
                tooltip="bash/PowerShell 스크립트 생성"
                style={{ marginBottom: 8 }}
              >
                <Switch size="small" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 파일 분할 설정 */}
        <Card
          title="파일 분할"
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="enableFileSplit"
                label="분할 사용"
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch size="small" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="maxFileSize"
                label="최대 크기 (MB)"
                tooltip="이메일 첨부 제한"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  size="small"
                  min={1}
                  max={1000}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* SMTP 설정 */}
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
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item name="smtpHost" label="SMTP 서버" style={{ marginBottom: 8 }}>
                <Input size="small" placeholder="smtp.example.com" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="smtpPort" label="포트" style={{ marginBottom: 8 }}>
                <InputNumber size="small" min={1} max={65535} style={{ width: '100%' }} placeholder="587" />
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

          <Space size={8}>
            <Button
              size="small"
              icon={<SendOutlined />}
              onClick={handleTestSmtp}
              loading={testingSmtp}
            >
              연결 테스트
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
        </Form>
      </div>
    </div>
  );
};

export default SettingsPage;
