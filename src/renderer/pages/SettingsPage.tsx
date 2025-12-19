import React, { useState, useEffect, useRef } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
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
  Modal,
  AutoComplete,
  List,
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
  WarningOutlined,
} from '@ant-design/icons';

import { useSettingsStore } from '../stores/settings-store';
import type { OSDistribution } from '../global';
import {
  LINUX_DISTRO_GLIBC_MAP,
  getDistrosByFamily,
  isDistroEOL,
  isDistroEOLSoon,
  getMacOSVersionsSorted,
  isMacOSVersionCompatibleWithArch,
  type MacOSVersionInfo,
} from '../../core/shared/platform-mappings';

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
    pipTargetPlatform,
    condaChannel,
    customCondaChannels,
    customPipIndexUrls,
    cudaVersion,
    yumDistribution,
    aptDistribution,
    apkDistribution,
    dockerArchitecture,
    dockerLayerCompression,
    dockerIncludeLoadScript,
    autoUpdate,
    autoDownloadUpdate,
    downloadRenderInterval,
    updateSettings,
    resetSettings,
    addCustomCondaChannel,
    removeCustomCondaChannel,
    addCustomPipIndexUrl,
    removeCustomPipIndexUrl,
  } = useSettingsStore();

  const [form] = Form.useForm();
  const [searchParams] = useSearchParams();
  const highlightType = searchParams.get('highlight');
  const highlightedRef = useRef<HTMLDivElement>(null);

  // 패키지 타입별 하이라이트할 설정 카드 ID 매핑
  const highlightSections: Record<string, string[]> = {
    pip: ['python-settings', 'library-env', 'pip-platform', 'pip-custom-index'],
    conda: ['python-settings', 'library-env'],
    maven: [],
    npm: [],
    yum: ['os-distribution'],
    apt: ['os-distribution'],
    apk: ['os-distribution'],
    docker: ['docker-settings'],
  };

  // 하이라이트된 카드 스타일
  const getCardStyle = (cardId: string) => {
    const baseStyle = { marginBottom: CARD_MARGIN };
    if (highlightType && highlightSections[highlightType]?.includes(cardId)) {
      return {
        ...baseStyle,
        boxShadow: '0 0 0 2px #1890ff',
        borderColor: '#1890ff',
      };
    }
    return baseStyle;
  };

  // 하이라이트된 첫 번째 섹션으로 스크롤
  useEffect(() => {
    if (highlightType && highlightedRef.current) {
      setTimeout(() => {
        highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [highlightType]);

  // 변경사항 감지 상태
  const [isDirty, setIsDirty] = useState(false);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [showNavigationModal, setShowNavigationModal] = useState(false);
  const isInitializedRef = React.useRef(false);

  // 캐시 상태
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [cacheCount, setCacheCount] = useState<number>(0);
  const [loadingCache, setLoadingCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // SMTP 테스트 상태
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<'success' | 'failed' | null>(null);

  // Python 버전 목록 상태
  const [pythonVersions, setPythonVersions] = useState<string[]>([
    '3.13',
    '3.12',
    '3.11',
    '3.10',
    '3.9',
  ]); // 폴백 목록
  const [loadingPythonVersions, setLoadingPythonVersions] = useState(false);

  // CUDA 버전 목록 상태
  const [cudaVersions, setCudaVersions] = useState<string[]>([
    '12.6',
    '12.5',
    '12.4',
    '12.1',
    '12.0',
    '11.8',
  ]); // 폴백 목록
  const [loadingCudaVersions, setLoadingCudaVersions] = useState(false);

  // pip 커스텀 인덱스 URL 관리 상태
  const [newIndexLabel, setNewIndexLabel] = useState('');
  const [newIndexUrl, setNewIndexUrl] = useState('');

  // Conda 채널 검증 상태
  const [validatingChannel, setValidatingChannel] = useState(false);

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
      // Electron IPC 사용 (개발/프로덕션 모두)
      if (!window.electronAPI?.cache?.getStats) {
        throw new Error('캐시 정보 API를 사용할 수 없습니다');
      }
      const stats = await window.electronAPI.cache.getStats();
      setCacheSize(stats.totalSize);
      setCacheCount(stats.entryCount);
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
      // Electron IPC 사용 (개발/프로덕션 모두)
      if (!window.electronAPI?.cache?.clear) {
        throw new Error('캐시 삭제 API를 사용할 수 없습니다');
      }
      await window.electronAPI.cache.clear();
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

  // Python 버전 목록 로드
  const loadPythonVersions = async () => {
    setLoadingPythonVersions(true);
    try {
      if (window.electronAPI?.versions?.python) {
        const versions = await window.electronAPI.versions.python();
        if (versions && versions.length > 0) {
          setPythonVersions(versions);
        }
      }
    } catch (error) {
      console.error('Python 버전 로드 실패:', error);
      // 폴백 목록 유지
    } finally {
      setLoadingPythonVersions(false);
    }
  };

  // CUDA 버전 목록 로드
  const loadCudaVersions = async () => {
    setLoadingCudaVersions(true);
    try {
      if (window.electronAPI?.versions?.cuda) {
        const versions = await window.electronAPI.versions.cuda();
        if (versions && versions.length > 0) {
          setCudaVersions(versions);
        }
      }
    } catch (error) {
      console.error('CUDA 버전 로드 실패:', error);
      // 폴백 목록 유지
    } finally {
      setLoadingCudaVersions(false);
    }
  };

  // OS 배포판 목록 로드
  const loadDistributions = async () => {
    setLoadingDistributions(true);
    try {
      // Electron IPC 사용 (개발/프로덕션 모두)
      if (!window.electronAPI?.os?.getAllDistributions) {
        console.warn('배포판 목록 API를 사용할 수 없습니다');
        return;
      }
      const data = await window.electronAPI.os.getAllDistributions() as OSDistribution[];
      setDistributions(data);
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
    loadPythonVersions();
    loadCudaVersions();
  }, []);

  // useBlocker로 페이지 이동 차단
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  // blocker 상태 변경 시 모달 표시
  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowNavigationModal(true);
    }
  }, [blocker.state]);

  // beforeunload 이벤트 (브라우저 새로고침/닫기)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  // 초기값 설정 (최초 1회만 실행)
  React.useEffect(() => {
    // 이미 초기화되었으면 스킵
    if (isInitializedRef.current) {
      return;
    }

    const values = {
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
      // pip 타겟 플랫폼
      pipTargetPlatform,
      condaChannel,
      cudaVersion,
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
      // UI 렌더링
      downloadRenderInterval,
    };

    form.setFieldsValue(values);
    // 초기값 저장 (변경사항 감지용)
    setInitialValues(values);
    setIsDirty(false);
    isInitializedRef.current = true;

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
    pipTargetPlatform,
    condaChannel,
    cudaVersion,
    yumDistribution,
    aptDistribution,
    apkDistribution,
    dockerArchitecture,
    dockerLayerCompression,
    dockerIncludeLoadScript,
    autoUpdate,
    autoDownloadUpdate,
    downloadRenderInterval,
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

    // 저장 후 isDirty 초기화
    const newValues = form.getFieldsValue();
    setInitialValues(newValues);
    setIsDirty(false);
  };

  // 초기화
  const handleReset = () => {
    resetSettings();
    form.resetFields();
    message.info('설정이 초기화되었습니다');

    // 초기화 후 isDirty 초기화
    const newValues = form.getFieldsValue();
    setInitialValues(newValues);
    setIsDirty(false);
  };

  // 폼 값 변경 감지
  const handleFormChange = (_changedValues?: Record<string, unknown>, allValues?: Record<string, unknown>) => {
    const currentValues = allValues || form.getFieldsValue();
    const hasChanges = JSON.stringify(currentValues) !== JSON.stringify(initialValues);
    setIsDirty(hasChanges);
  };

  // checkDirty는 handleFormChange의 alias
  const checkDirty = handleFormChange;

  // 모달 핸들러
  const handleNavigationConfirm = async (shouldSave: boolean) => {
    if (shouldSave) {
      // 저장 후 이동
      try {
        await form.validateFields();
        handleSave(form.getFieldsValue());
        blocker.proceed?.();
      } catch (error) {
        // 유효성 검증 실패 시 이동 취소
        message.error('설정 저장에 실패했습니다');
      }
    } else {
      // 저장 안 함, 그냥 이동
      blocker.proceed?.();
    }
    setShowNavigationModal(false);
  };

  const handleNavigationCancel = () => {
    blocker.reset?.();
    setShowNavigationModal(false);
  };

  // 폴더 선택
  const handleSelectFolder = async () => {
    if (window.electronAPI?.selectFolder) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        form.setFieldsValue({ defaultOutputPath: folder });
        checkDirty(); // 폴더 선택 후 dirty 체크
        message.success('폴더가 선택되었습니다');
      }
    } else {
      message.info('폴더 선택 기능은 Electron 환경에서 사용 가능합니다');
    }
  };

  // 커스텀 Conda 채널 추가
  const handleAddCustomChannel = async (channel: string) => {
    // 빈 값 체크
    if (!channel || !channel.trim()) {
      return;
    }

    const trimmedChannel = channel.trim();

    // 이미 기본 채널인지 확인
    const defaultChannels = ['conda-forge', 'anaconda', 'bioconda', 'pytorch'];
    if (defaultChannels.includes(trimmedChannel)) {
      message.info('기본 채널입니다');
      return;
    }

    // 이미 추가된 채널인지 확인
    if (customCondaChannels.includes(trimmedChannel)) {
      message.info('이미 추가된 채널입니다');
      return;
    }

    // 채널 유효성 검증
    setValidatingChannel(true);
    try {
      const { validateCondaChannel } = await import('../../core/shared/conda-validator');
      const isValid = await validateCondaChannel(trimmedChannel);

      if (isValid) {
        addCustomCondaChannel(trimmedChannel);
        message.success(`채널 '${trimmedChannel}'이(가) 추가되었습니다`);
        checkDirty();
      } else {
        message.error(`채널 '${trimmedChannel}'을(를) 찾을 수 없습니다`);
      }
    } catch (error) {
      message.error('채널 검증 중 오류가 발생했습니다');
      console.error('Conda 채널 검증 오류:', error);
    } finally {
      setValidatingChannel(false);
    }
  };

  // 커스텀 Conda 채널 삭제
  const handleRemoveCustomChannel = (channel: string) => {
    removeCustomCondaChannel(channel);
    message.success(`채널 '${channel}'이(가) 삭제되었습니다`);
    checkDirty();
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
    checkDirty(); // 배포판 변경 후 dirty 체크
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
          onValuesChange={handleFormChange}
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
                    checkDirty(); // 폴더 선택 후 dirty 체크
                  }
                } else {
                  message.info('폴더 선택은 Electron 환경에서만 가능합니다');
                }
              }}
              readOnly
            />
          </Form.Item>
        </Card>

        {/* Python 버전 설정 */}
        <div
          id="python-settings"
          ref={highlightType && highlightSections[highlightType]?.includes('python-settings') ? highlightedRef : undefined}
        >
        <Card
          title={
            <Space>
              <span>Python 버전 설정</span>
              <Tag color="purple">pip/conda</Tag>
              <Tooltip title="pip/conda 패키지 다운로드 시 사용할 Python 버전. 휠 파일(.whl)은 Python 버전별로 다른 바이너리를 제공합니다. Maven JAR와 npm tarball은 런타임 버전과 무관하게 동일 파일을 다운로드하므로 별도 설정이 필요 없습니다.">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('python-settings')}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Form.Item
            name={['languageVersions', 'python']}
            label="Python 버전"
            tooltip="pip/conda 패키지의 휠 파일 호환성에 영향"
            style={{ marginBottom: 8 }}
          >
            <Select size="small" loading={loadingPythonVersions}>
              {pythonVersions.map((version) => (
                <Select.Option key={version} value={version}>
                  {version}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="condaChannel"
            label="Conda 채널"
            tooltip="기본 채널 선택 또는 커스텀 채널 입력 가능"
            style={{ marginBottom: 8 }}
          >
            <Select
              size="small"
              showSearch
              placeholder="채널 선택 또는 입력"
              onSearch={(value) => {
                // Enter 키 입력 시 검증 및 추가
                if (value && !['conda-forge', 'anaconda', 'bioconda', 'pytorch'].includes(value)) {
                  // 커스텀 채널로 간주
                }
              }}
              onSelect={(value) => {
                form.setFieldsValue({ condaChannel: value });
                checkDirty();
              }}
              loading={validatingChannel}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ padding: '0 8px 4px' }}>
                    <Input.Search
                      size="small"
                      placeholder="커스텀 채널 입력 후 Enter"
                      onSearch={handleAddCustomChannel}
                      loading={validatingChannel}
                      disabled={validatingChannel}
                    />
                  </div>
                </>
              )}
            >
              <Select.Option value="conda-forge">conda-forge (커뮤니티)</Select.Option>
              <Select.Option value="anaconda">anaconda (공식)</Select.Option>
              <Select.Option value="bioconda">bioconda (생명과학)</Select.Option>
              <Select.Option value="pytorch">pytorch</Select.Option>
              {customCondaChannels.map((channel) => (
                <Select.Option key={channel} value={channel}>
                  {channel} (커스텀)
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {customCondaChannels.length > 0 && (
            <Form.Item label="커스텀 채널" style={{ marginBottom: 8 }}>
              <Space wrap>
                {customCondaChannels.map((channel) => (
                  <Tag
                    key={channel}
                    closable
                    onClose={() => handleRemoveCustomChannel(channel)}
                  >
                    {channel}
                  </Tag>
                ))}
              </Space>
            </Form.Item>
          )}
          <Form.Item
            name="cudaVersion"
            label="CUDA 버전"
            tooltip="폐쇄망 GPU 서버의 CUDA 버전. conda 패키지의 __cuda 의존성 필터링에 사용. 목록에 없는 버전은 직접 입력 가능"
            style={{ marginBottom: 0 }}
          >
            <AutoComplete
              size="small"
              placeholder="없음 (CPU only) 또는 직접 입력"
              allowClear
              options={cudaVersions.map((version) => ({
                value: version,
                label: `CUDA ${version}`,
              }))}
              filterOption={(inputValue, option) =>
                option!.value.toLowerCase().includes(inputValue.toLowerCase())
              }
              notFoundContent={loadingCudaVersions ? <Spin size="small" /> : null}
            />
          </Form.Item>
        </Card>
        </div>

        {/* 라이브러리 대상 환경 설정 */}
        <div
          id="library-env"
          ref={highlightType && highlightSections[highlightType]?.includes('library-env') && !highlightSections[highlightType]?.includes('python-settings') ? highlightedRef : undefined}
        >
        <Card
          title={
            <Space>
              <span>라이브러리 대상 환경</span>
              <Tag color="blue">pip/conda</Tag>
              <Tooltip title="폐쇄망에 설치된 OS와 CPU 아키텍처에 맞는 바이너리를 다운로드합니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('library-env')}
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
        </div>

        {/* pip 타겟 플랫폼 설정 */}
        <div
          id="pip-platform"
          ref={highlightType === 'pip' && !highlightSections.pip.slice(0, 2).some(id => highlightSections.pip.includes(id)) ? highlightedRef : undefined}
        >
        <Card
          title={
            <Space>
              <span>pip Wheel 호환성 설정</span>
              <Tag color="purple">pip</Tag>
              <Tooltip title="폐쇄망 환경의 Linux 배포판 및 glibc 버전, macOS 버전에 맞는 wheel 파일을 다운로드합니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('pip-platform')}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          {/* OS 선택 */}
          <Form.Item
            name={['pipTargetPlatform', 'os']}
            label="타겟 OS"
            style={{ marginBottom: 8 }}
          >
            <Select size="small">
              <Select.Option value="linux">Linux</Select.Option>
              <Select.Option value="macos">macOS</Select.Option>
              <Select.Option value="windows">Windows</Select.Option>
            </Select>
          </Form.Item>

          {/* Linux 전용 설정 */}
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.pipTargetPlatform?.os !== curr.pipTargetPlatform?.os}>
            {({ getFieldValue }) => {
              const pipOs = getFieldValue(['pipTargetPlatform', 'os']);

              if (pipOs === 'linux') {
                return (
                  <>
                    <Form.Item
                      name={['pipTargetPlatform', 'linuxDistro']}
                      label="Linux 배포판"
                      tooltip="배포판에 따라 glibc 버전이 자동으로 설정됩니다"
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        size="small"
                        onChange={(value) => {
                          // 중앙 매핑에서 glibc 버전 가져오기
                          const distro = LINUX_DISTRO_GLIBC_MAP[value];
                          const glibc = distro?.glibcVersion || '2.34';
                          form.setFieldValue(['pipTargetPlatform', 'glibcVersion'], glibc);
                          checkDirty(); // glibc 버전 변경 후 dirty 체크
                        }}
                      >
                        {Object.entries(getDistrosByFamily()).map(([family, distros]) => {
                          // family 한글 라벨
                          const familyLabels: Record<string, string> = {
                            rhel: 'RHEL 계열',
                            ubuntu: 'Ubuntu',
                            debian: 'Debian',
                            other: '기타'
                          };

                          return (
                            <Select.OptGroup key={family} label={familyLabels[family]}>
                              {distros.map(distro => {
                                const isEOL = isDistroEOL(distro.id);
                                const isEOLSoon = isDistroEOLSoon(distro.id, 6);

                                return (
                                  <Select.Option
                                    key={distro.id}
                                    value={distro.id}
                                    disabled={isEOL}
                                  >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      {distro.name} (glibc {distro.glibcVersion})
                                      {isEOL && (
                                        <Tooltip title={`지원 종료: ${distro.eolDate}`}>
                                          <WarningOutlined style={{ color: '#ff4d4f' }} />
                                        </Tooltip>
                                      )}
                                      {isEOLSoon && !isEOL && (
                                        <Tooltip title={`곧 지원 종료 예정: ${distro.eolDate}`}>
                                          <InfoCircleOutlined style={{ color: '#faad14' }} />
                                        </Tooltip>
                                      )}
                                    </span>
                                  </Select.Option>
                                );
                              })}
                            </Select.OptGroup>
                          );
                        })}
                      </Select>
                    </Form.Item>
                    <Form.Item
                      name={['pipTargetPlatform', 'glibcVersion']}
                      label="glibc 버전"
                      tooltip="수동으로 변경 가능합니다. wheel 파일의 manylinux 태그와 매칭됩니다."
                      style={{ marginBottom: 8 }}
                    >
                      <Select size="small">
                        <Select.Option value="2.17">2.17 (manylinux2014, CentOS 7)</Select.Option>
                        <Select.Option value="2.28">2.28 (manylinux_2_28, RHEL 8)</Select.Option>
                        <Select.Option value="2.31">2.31 (manylinux_2_31, Ubuntu 20.04)</Select.Option>
                        <Select.Option value="2.34">2.34 (manylinux_2_34, RHEL 9)</Select.Option>
                        <Select.Option value="2.35">2.35 (manylinux_2_35, Ubuntu 22.04)</Select.Option>
                        <Select.Option value="2.36">2.36 (manylinux_2_36, Debian 12)</Select.Option>
                        <Select.Option value="2.39">2.39 (manylinux_2_39, Ubuntu 24.04)</Select.Option>
                      </Select>
                    </Form.Item>
                  </>
                );
              }

              if (pipOs === 'macos') {
                const macosVersions = getMacOSVersionsSorted();

                return (
                  <Form.Item
                    name={['pipTargetPlatform', 'macosVersion']}
                    label="macOS 버전"
                    tooltip="macOS 최소 버전. wheel 파일의 macosx 태그와 매칭됩니다."
                    style={{ marginBottom: 8 }}
                  >
                    <Select size="small">
                      {macosVersions.map((info: MacOSVersionInfo) => {
                        // 아키텍처 표시 문자열 생성
                        let archLabel = '';
                        if (info.minArch === 'intel') {
                          archLabel = ' (Intel only)';
                        } else if (info.minArch === 'apple_silicon') {
                          archLabel = ' (Apple Silicon only)';
                        } else {
                          archLabel = ' (Both)';
                        }

                        // 선택지 텍스트: "macOS 11.0 Big Sur (Both)"
                        const label = `macOS ${info.version} ${info.name}${archLabel}`;

                        return (
                          <Select.Option key={info.version} value={info.version}>
                            {label}
                          </Select.Option>
                        );
                      })}
                    </Select>
                  </Form.Item>
                );
              }

              // Windows는 추가 설정 불필요 (아키텍처만 사용)
              return null;
            }}
          </Form.Item>

          {/* macOS 아키텍처 호환성 경고 */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) =>
              prev.pipTargetPlatform?.macosVersion !== curr.pipTargetPlatform?.macosVersion ||
              prev.pipTargetPlatform?.arch !== curr.pipTargetPlatform?.arch ||
              prev.pipTargetPlatform?.os !== curr.pipTargetPlatform?.os
            }
          >
            {({ getFieldValue }) => {
              const macosVer = getFieldValue(['pipTargetPlatform', 'macosVersion']);
              const arch = getFieldValue(['pipTargetPlatform', 'arch']);
              const pipOs = getFieldValue(['pipTargetPlatform', 'os']);

              if (pipOs === 'macos' && macosVer && arch) {
                // x86_64 또는 arm64만 체크
                const normalizedArch =
                  arch === 'x86_64' ? 'x86_64' : arch === 'arm64' ? 'arm64' : null;

                if (normalizedArch && !isMacOSVersionCompatibleWithArch(macosVer, normalizedArch)) {
                  return (
                    <Alert
                      message="아키텍처 호환성 경고"
                      description={`macOS ${macosVer}는 ${arch} 아키텍처를 지원하지 않을 수 있습니다.`}
                      type="warning"
                      showIcon
                      style={{ marginBottom: 8 }}
                    />
                  );
                }
              }

              return null;
            }}
          </Form.Item>

          {/* 아키텍처 */}
          <Form.Item
            name={['pipTargetPlatform', 'arch']}
            label="CPU 아키텍처"
            style={{ marginBottom: 0 }}
          >
            <Select size="small">
              <Select.Option value="x86_64">x86_64 (Intel/AMD 64-bit)</Select.Option>
              <Select.Option value="aarch64">aarch64 (ARM 64-bit)</Select.Option>
              <Select.Option value="arm64">arm64 (macOS Apple Silicon)</Select.Option>
              <Select.Option value="i386">i386 (32-bit)</Select.Option>
              <Select.Option value="amd64">amd64 (Windows 64-bit)</Select.Option>
            </Select>
          </Form.Item>
        </Card>
        </div>

        {/* pip 커스텀 인덱스 URL 관리 */}
        <div id="pip-custom-index">
        <Card
          title={
            <Space>
              <span>pip 커스텀 인덱스 URL</span>
              <Tag color="purple">pip</Tag>
              <Tooltip title="자주 사용하는 pip 인덱스 URL을 저장하여 WizardPage에서 빠르게 선택할 수 있습니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('pip-custom-index')}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <List
            dataSource={customPipIndexUrls}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => {
                      removeCustomPipIndexUrl(item.url);
                      message.success('인덱스 URL이 삭제되었습니다');
                    }}
                  >
                    삭제
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={item.label}
                  description={<Text copyable>{item.url}</Text>}
                />
              </List.Item>
            )}
            locale={{ emptyText: '저장된 인덱스 URL이 없습니다' }}
            style={{ marginBottom: 16 }}
          />

          <Divider style={{ margin: '12px 0' }} />

          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Input
              size="small"
              placeholder="라벨 (예: PyTorch CUDA 12.4)"
              value={newIndexLabel}
              onChange={(e) => setNewIndexLabel(e.target.value)}
            />
            <Input
              size="small"
              placeholder="URL (예: https://download.pytorch.org/whl/cu124)"
              value={newIndexUrl}
              onChange={(e) => setNewIndexUrl(e.target.value)}
            />
            <Button
              type="primary"
              size="small"
              onClick={() => {
                if (newIndexLabel.trim() && newIndexUrl.trim()) {
                  addCustomPipIndexUrl(newIndexLabel.trim(), newIndexUrl.trim());
                  setNewIndexLabel('');
                  setNewIndexUrl('');
                  message.success('인덱스 URL이 추가되었습니다');
                } else {
                  message.warning('라벨과 URL을 모두 입력하세요');
                }
              }}
            >
              추가
            </Button>
          </Space>
        </Card>
        </div>

        {/* OS 패키지 배포판 설정 */}
        <div
          id="os-distribution"
          ref={highlightType && highlightSections[highlightType]?.includes('os-distribution') ? highlightedRef : undefined}
        >
        <Card
          title={
            <Space>
              <span>OS 패키지 배포판</span>
              <Tag color="orange">yum/apt/apk</Tag>
              <Tooltip title="각 패키지 관리자별로 검색할 배포판과 아키텍처를 설정합니다">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('os-distribution')}
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
        </div>

        {/* Docker 설정 */}
        <div
          id="docker-settings"
          ref={highlightType === 'docker' ? highlightedRef : undefined}
        >
        <Card
          title={
            <Space>
              <CloudOutlined />
              <span>Docker 설정</span>
              <Tag color="geekblue">docker</Tag>
              <Tooltip title="컨테이너 이미지를 다운로드할 때 사용할 레지스트리, 아키텍처 및 옵션">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
          size="small"
          style={getCardStyle('docker-settings')}
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
        </div>

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

        {/* UI 렌더링 설정 */}
        <Card
          title="UI 렌더링"
          size="small"
          style={{ marginBottom: CARD_MARGIN }}
          styles={{ body: { padding: CARD_BODY_PADDING } }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="downloadRenderInterval"
                label="다운로드 화면 갱신 간격"
                style={{ marginBottom: 8 }}
                tooltip="다운로드 진행 상황 UI 갱신 간격을 설정합니다. 값이 클수록 CPU 사용량이 줄어듭니다."
              >
                <Select size="small">
                  <Select.Option value={100}>0.1초 (빠름)</Select.Option>
                  <Select.Option value={300}>0.3초 (기본)</Select.Option>
                  <Select.Option value={500}>0.5초</Select.Option>
                  <Select.Option value={1000}>1초 (느림)</Select.Option>
                  <Select.Option value={2000}>2초 (매우 느림)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <div style={{ fontSize: 12, color: '#888', paddingTop: 24 }}>
                낮은 값: 부드러운 애니메이션, 높은 CPU 사용<br />
                높은 값: 끊김 현상, 낮은 CPU 사용
              </div>
            </Col>
          </Row>
        </Card>

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

      {/* 저장 확인 모달 */}
      <Modal
        title="저장하지 않은 변경사항"
        open={showNavigationModal}
        onCancel={handleNavigationCancel}
        footer={[
          <Button key="cancel" onClick={handleNavigationCancel}>
            취소
          </Button>,
          <Button key="no-save" onClick={() => handleNavigationConfirm(false)}>
            저장 안 함
          </Button>,
          <Button key="save" type="primary" onClick={() => handleNavigationConfirm(true)}>
            저장 후 이동
          </Button>,
        ]}
      >
        <p>저장하지 않은 변경사항이 있습니다.</p>
        <p>변경사항을 저장하시겠습니까?</p>
      </Modal>
    </div>
  );
};

export default SettingsPage;
