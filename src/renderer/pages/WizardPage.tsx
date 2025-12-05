import React, { useState, useRef, useCallback } from 'react';
import {
  Steps,
  Card,
  Radio,
  Input,
  Select,
  Button,
  Table,
  Space,
  Typography,
  message,
  Empty,
  Spin,
  Tag,
  Divider,
  Alert,
  Dropdown,
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
  AppstoreOutlined,
  CodeOutlined,
  CloudServerOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import { useCartStore, PackageType, Architecture } from '../stores/cartStore';
import { useSettingsStore } from '../stores/settingsStore';

const { Title, Text } = Typography;

// 카테고리 타입
type CategoryType = 'library' | 'os' | 'container';

// 카테고리 옵션
const categoryOptions: { value: CategoryType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: 'library',
    label: '라이브러리',
    icon: <CodeOutlined />,
    description: 'Python, Java, Node.js 등의 개발 라이브러리'
  },
  {
    value: 'os',
    label: 'OS 패키지',
    icon: <CloudServerOutlined />,
    description: 'Linux 시스템 패키지 (YUM, APT, APK)'
  },
  {
    value: 'container',
    label: '컨테이너 이미지',
    icon: <ContainerOutlined />,
    description: 'Docker 컨테이너 이미지'
  },
];

// 패키지 타입 옵션
const packageTypeOptions: { value: PackageType; label: string; category: CategoryType; description: string }[] = [
  { value: 'pip', label: 'pip', category: 'library', description: 'Python 패키지 (PyPI)' },
  { value: 'conda', label: 'conda', category: 'library', description: 'Python/R 패키지 (Anaconda)' },
  { value: 'maven', label: 'Maven', category: 'library', description: 'Java 라이브러리 및 플러그인' },
  { value: 'gradle', label: 'Gradle', category: 'library', description: 'Java/Kotlin 빌드 도구' },
  { value: 'npm', label: 'npm', category: 'library', description: 'Node.js 패키지' },
  { value: 'yum', label: 'YUM', category: 'os', description: 'RHEL/CentOS/Fedora 패키지' },
  { value: 'apt', label: 'APT', category: 'os', description: 'Ubuntu/Debian 패키지' },
  { value: 'apk', label: 'APK', category: 'os', description: 'Alpine Linux 패키지' },
  { value: 'docker', label: 'Docker', category: 'container', description: 'Docker Hub 이미지' },
];

// 아키텍처 옵션
const archOptions: { value: Architecture; label: string; description: string }[] = [
  { value: 'x86_64', label: 'x86_64', description: '64비트 Intel/AMD (가장 일반적)' },
  { value: 'amd64', label: 'amd64', description: '64비트 AMD (x86_64와 동일)' },
  { value: 'arm64', label: 'ARM64', description: '64비트 ARM (Apple Silicon, AWS Graviton)' },
  { value: 'aarch64', label: 'aarch64', description: '64비트 ARM (arm64와 동일)' },
  { value: 'i386', label: 'i386', description: '32비트 Intel/AMD' },
  { value: 'noarch', label: 'noarch', description: '아키텍처 무관 (순수 스크립트)' },
];

// 언어 버전 옵션
interface LanguageVersionOption {
  value: string;
  label: string;
  eol?: boolean;
}

const languageVersionOptions: Record<string, LanguageVersionOption[]> = {
  pip: [
    { value: '3.13', label: 'Python 3.13' },
    { value: '3.12', label: 'Python 3.12' },
    { value: '3.11', label: 'Python 3.11' },
    { value: '3.10', label: 'Python 3.10' },
    { value: '3.9', label: 'Python 3.9' },
    { value: '3.8', label: 'Python 3.8', eol: true },
  ],
  conda: [
    { value: '3.13', label: 'Python 3.13' },
    { value: '3.12', label: 'Python 3.12' },
    { value: '3.11', label: 'Python 3.11' },
    { value: '3.10', label: 'Python 3.10' },
    { value: '3.9', label: 'Python 3.9' },
    { value: '3.8', label: 'Python 3.8', eol: true },
  ],
  maven: [
    { value: '21', label: 'Java 21 (LTS)' },
    { value: '17', label: 'Java 17 (LTS)' },
    { value: '11', label: 'Java 11 (LTS)' },
    { value: '8', label: 'Java 8 (LTS)' },
  ],
  gradle: [
    { value: '21', label: 'Java 21 (LTS)' },
    { value: '17', label: 'Java 17 (LTS)' },
    { value: '11', label: 'Java 11 (LTS)' },
    { value: '8', label: 'Java 8 (LTS)' },
  ],
  npm: [
    { value: '22', label: 'Node.js 22 (Current)' },
    { value: '20', label: 'Node.js 20 (LTS)' },
    { value: '18', label: 'Node.js 18 (LTS)' },
    { value: '16', label: 'Node.js 16', eol: true },
  ],
};

// 패키지 타입에서 언어 키 가져오기
const getLanguageKey = (type: PackageType): 'python' | 'java' | 'node' | null => {
  switch (type) {
    case 'pip':
    case 'conda':
      return 'python';
    case 'maven':
    case 'gradle':
      return 'java';
    case 'npm':
      return 'node';
    default:
      return null;
  }
};

// 언어 버전 선택 단계 스킵 여부
const shouldSkipLanguageVersion = (type: PackageType): boolean => {
  return ['yum', 'apt', 'apk', 'docker'].includes(type);
};

// 검색 결과 아이템
interface SearchResult {
  name: string;
  version: string;
  description?: string;
  versions?: string[];
}

const WizardPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: 카테고리
  const [category, setCategory] = useState<CategoryType>('library');

  // Step 2: 패키지 타입
  const [packageType, setPackageType] = useState<PackageType>('pip');

  // Step 3: 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<SearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 4: 버전
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Step 2: 언어 버전
  const [languageVersion, setLanguageVersion] = useState<string>('');

  // Step 5: 아키텍처
  const [architecture, setArchitecture] = useState<Architecture>('x86_64');

  const { addItem, hasItem } = useCartStore();
  const { languageVersions, defaultArchitecture, defaultTargetOS, condaChannel } = useSettingsStore();

  // 라이브러리 패키지 타입 (설정 기본값 적용 대상)
  const libraryPackageTypes: PackageType[] = ['pip', 'conda', 'maven', 'gradle', 'npm'];

  // OS/아키텍처 설정 적용 여부 판단 함수
  const shouldApplyDefaultOSArch = (type: PackageType): boolean => {
    return libraryPackageTypes.includes(type);
  };

  // 카테고리에 맞는 패키지 타입 필터링
  const filteredPackageTypes = packageTypeOptions.filter(
    (opt) => opt.category === category
  );

  // 카테고리 변경 시 기본 패키지 타입 설정
  const handleCategoryChange = (newCategory: CategoryType) => {
    setCategory(newCategory);
    const firstType = packageTypeOptions.find((opt) => opt.category === newCategory);
    if (firstType) {
      setPackageType(firstType.value);
    }
    resetSearch();
  };

  // 검색 초기화
  const resetSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPackage(null);
    setSelectedVersion('');
    setAvailableVersions([]);
    setSuggestions([]);
    setShowSuggestions(false);
    // 언어 버전은 초기화하지 않음 (설정에서 가져온 기본값 유지)
  };

  // 패키지 타입 변경 시 기본 언어 버전 설정
  React.useEffect(() => {
    const langKey = getLanguageKey(packageType);
    if (langKey && languageVersions[langKey]) {
      setLanguageVersion(languageVersions[langKey]);
    } else {
      setLanguageVersion('');
    }
  }, [packageType, languageVersions]);

  // 패키지 타입 변경 시 아키텍처 기본값 설정
  React.useEffect(() => {
    if (shouldApplyDefaultOSArch(packageType)) {
      // 라이브러리 패키지: 설정에서 가져온 기본값 적용
      setArchitecture(defaultArchitecture as Architecture);
    } else {
      // OS 패키지/컨테이너: 수동 선택 (기본값 x86_64)
      setArchitecture('x86_64');
    }
  }, [packageType, defaultArchitecture]);

  // 디바운스된 실시간 검색
  const debouncedSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setSearching(true);
    try {
      let results: SearchResult[];
      if (window.electronAPI?.search?.packages) {
        // conda일 때 채널 옵션 전달
        const searchOptions = packageType === 'conda' ? { channel: condaChannel } : undefined;
        const response = await window.electronAPI.search.packages(packageType, query, searchOptions);
        results = response.results;
      } else {
        // 브라우저 환경: 패키지 타입별 API 직접 호출
        results = await searchPackageByType(packageType, query);
      }
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      console.error('Search error:', error);
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, [packageType, condaChannel]);

  // 입력 변경 핸들러 (디바운스 적용)
  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);

    // 기존 타이머 취소
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 새 디바운스 타이머 설정 (300ms)
    debounceTimerRef.current = setTimeout(() => {
      debouncedSearch(value);
    }, 300);
  }, [debouncedSearch]);

  // 제안 항목 선택
  const handleSuggestionSelect = (item: SearchResult) => {
    setShowSuggestions(false);
    setSearchQuery(item.name);
    setSearchResults([item]);
    handleSelectPackage(item);
  };

  // 브라우저에서 PyPI API로 패키지 검색
  const searchPyPIPackage = async (query: string): Promise<SearchResult[]> => {
    try {
      const response = await fetch(`/api/pypi/pypi/${encodeURIComponent(query)}/json`);
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error('패키지를 찾을 수 없습니다');
      }
      const data = await response.json();
      const versions = Object.keys(data.releases).sort((a, b) => {
        // 버전 내림차순 정렬 (최신 버전 우선)
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
          const numA = partsA[i] || 0;
          const numB = partsB[i] || 0;
          if (numB !== numA) return numB - numA;
        }
        return 0;
      });
      return [{
        name: data.info.name,
        version: data.info.version,
        description: data.info.summary || '',
        versions: versions.slice(0, 20), // 최신 20개 버전만
      }];
    } catch (error) {
      console.error('PyPI search error:', error);
      return [];
    }
  };

  // 브라우저에서 Maven Central API로 패키지 검색
  const searchMavenPackage = async (query: string): Promise<SearchResult[]> => {
    try {
      const response = await fetch(`/api/maven/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('Maven search error:', error);
      return [];
    }
  };

  // 브라우저에서 npm Registry API로 패키지 검색
  const searchNpmPackage = async (query: string): Promise<SearchResult[]> => {
    try {
      const response = await fetch(`/api/npm/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('npm search error:', error);
      return [];
    }
  };

  // 브라우저에서 Docker Hub API로 이미지 검색
  const searchDockerImage = async (query: string): Promise<SearchResult[]> => {
    try {
      const response = await fetch(`/api/docker/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('Docker search error:', error);
      return [];
    }
  };

  // 패키지 타입별 브라우저 검색 함수
  const searchPackageByType = async (type: PackageType, query: string): Promise<SearchResult[]> => {
    switch (type) {
      case 'pip':
      case 'conda':
        return searchPyPIPackage(query);
      case 'maven':
      case 'gradle':
        return searchMavenPackage(query);
      case 'npm':
        return searchNpmPackage(query);
      case 'docker':
        return searchDockerImage(query);
      case 'yum':
      case 'apt':
      case 'apk':
        // OS 패키지는 아직 구현되지 않음 - 빈 결과 반환
        console.warn(`${type} 패키지 검색은 아직 지원되지 않습니다`);
        return [];
      default:
        return [];
    }
  };

  // 패키지 검색 (IPC 호출)
  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      message.warning('검색어를 입력하세요');
      return;
    }

    setSearching(true);
    setSearchResults([]);

    try {
      let results: SearchResult[];

      if (window.electronAPI?.search?.packages) {
        // conda일 때 채널 옵션 전달
        const searchOptions = packageType === 'conda' ? { channel: condaChannel } : undefined;
        const response = await window.electronAPI.search.packages(packageType, query, searchOptions);
        results = response.results;
      } else {
        // 브라우저 환경: 패키지 타입별 API 직접 호출
        results = await searchPackageByType(packageType, query);
      }

      setSearchResults(results);

      if (results.length === 0) {
        message.info('검색 결과가 없습니다');
      }
    } catch (error) {
      message.error('검색 중 오류가 발생했습니다');
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  // 브라우저에서 PyPI API로 버전 목록 조회
  const fetchPyPIVersions = async (packageName: string): Promise<string[]> => {
    try {
      const response = await fetch(`/api/pypi/pypi/${encodeURIComponent(packageName)}/json`);
      if (!response.ok) return [];
      const data = await response.json();
      const versions = Object.keys(data.releases).sort((a, b) => {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
          const numA = partsA[i] || 0;
          const numB = partsB[i] || 0;
          if (numB !== numA) return numB - numA;
        }
        return 0;
      });
      return versions;
    } catch (error) {
      console.error('PyPI versions fetch error:', error);
      return [];
    }
  };

  // 패키지 선택 및 버전 목록 조회
  const handleSelectPackage = async (record: SearchResult) => {
    setSelectedPackage(record);
    setSelectedVersion(record.version);
    setCurrentStep(4); // 버전 선택 단계로 이동
    setLoadingVersions(true);

    try {
      if (window.electronAPI?.search?.versions) {
        // conda일 때 채널 옵션 전달
        const searchOptions = packageType === 'conda' ? { channel: condaChannel } : undefined;
        const response = await window.electronAPI.search.versions(packageType, record.name, searchOptions);
        if (response.versions && response.versions.length > 0) {
          setAvailableVersions(response.versions);
          setSelectedVersion(response.versions[0]);
        } else {
          setAvailableVersions([record.version]);
        }
      } else if (packageType === 'pip' || packageType === 'conda') {
        // 브라우저 환경: PyPI API 직접 호출
        const versions = await fetchPyPIVersions(record.name);
        if (versions.length > 0) {
          setAvailableVersions(versions);
          setSelectedVersion(versions[0]);
        } else {
          setAvailableVersions(record.versions || [record.version]);
        }
      } else {
        setAvailableVersions(record.versions || [record.version]);
      }
    } catch (error) {
      console.error('Version fetch error:', error);
      setAvailableVersions([record.version]);
    } finally {
      setLoadingVersions(false);
    }
  };

  // 장바구니 추가
  const handleAddToCart = () => {
    if (!selectedPackage) return;

    if (hasItem(packageType, selectedPackage.name, selectedVersion)) {
      message.warning('이미 장바구니에 있는 패키지입니다');
      return;
    }

    // 라이브러리 패키지는 설정값 자동 적용
    const effectiveArch = libraryPackageTypes.includes(packageType)
      ? (defaultArchitecture as Architecture)
      : architecture;

    addItem({
      type: packageType,
      name: selectedPackage.name,
      version: selectedVersion,
      arch: effectiveArch,
      languageVersion: languageVersion || undefined,
      metadata: {
        description: selectedPackage.description,
        category,
        // 라이브러리 패키지는 targetOS도 저장
        ...(libraryPackageTypes.includes(packageType) && { targetOS: defaultTargetOS }),
      },
    });

    message.success(`${selectedPackage.name}@${selectedVersion}이(가) 장바구니에 추가되었습니다`);
    resetSearch();
    setCurrentStep(3); // 검색 단계로 이동
  };

  // 검색 결과 테이블 컬럼
  const columns = [
    {
      title: '패키지명',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '최신 버전',
      dataIndex: 'version',
      key: 'version',
      width: 120,
      render: (version: string) => <Tag color="blue">{version}</Tag>,
    },
    {
      title: '설명',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '액션',
      key: 'action',
      width: 100,
      render: (_: unknown, record: SearchResult) => (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => handleSelectPackage(record)}
        >
          선택
        </Button>
      ),
    },
  ];

  // 단계 정보 (언어 버전 단계 스킵 여부에 따라 동적 생성)
  const getStepItems = () => {
    const baseSteps = [
      { title: '카테고리', icon: <AppstoreOutlined /> },
      { title: '패키지 타입', icon: <CodeOutlined /> },
    ];

    if (!shouldSkipLanguageVersion(packageType)) {
      // 라이브러리 패키지: "환경 확인" 단계 (읽기 전용)
      baseSteps.push({ title: '환경 확인', icon: <CloudServerOutlined /> });
    }

    baseSteps.push(
      { title: '검색', icon: <SearchOutlined /> },
      { title: '버전', icon: <Tag /> }
    );

    // OS/컨테이너 패키지만 아키텍처 선택 단계 표시
    if (!libraryPackageTypes.includes(packageType)) {
      baseSteps.push({ title: '아키텍처', icon: <CloudServerOutlined /> });
    }

    return baseSteps;
  };

  const stepItems = getStepItems();

  // 현재 표시할 단계 인덱스 계산
  const getDisplayStep = () => {
    if (libraryPackageTypes.includes(packageType)) {
      // 라이브러리 패키지: 0,1,2,3,4 -> 0,1,2,3,4 (아키텍처 단계 없음)
      return currentStep;
    } else {
      // OS/컨테이너 패키지: 0,1 -> 0,1 / 3,4,5 -> 2,3,4 (환경 확인 단계 없음)
      if (currentStep <= 1) return currentStep;
      return currentStep - 1;
    }
  };

  // 아키텍처 경고 표시 여부
  const showArchWarning = category === 'container' || packageType === 'pip' || packageType === 'npm';

  // 현재 단계 렌더링
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card>
            <Title level={5}>패키지 카테고리를 선택하세요</Title>
            <Text type="secondary">다운로드할 패키지의 종류를 선택합니다</Text>
            <Divider />
            <Radio.Group
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {categoryOptions.map((opt) => (
                  <Radio.Button
                    key={opt.value}
                    value={opt.value}
                    style={{ width: '100%', height: 'auto', padding: '16px', display: 'flex', alignItems: 'flex-start' }}
                  >
                    <Space>
                      <span style={{ fontSize: 24 }}>{opt.icon}</span>
                      <div>
                        <div style={{ fontWeight: 'bold' }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: '#666' }}>{opt.description}</div>
                      </div>
                    </Space>
                  </Radio.Button>
                ))}
              </Space>
            </Radio.Group>
            <div style={{ marginTop: 24 }}>
              <Button type="primary" onClick={() => setCurrentStep(1)}>다음</Button>
            </div>
          </Card>
        );

      case 1:
        return (
          <Card>
            <Title level={5}>패키지 관리자를 선택하세요</Title>
            <Text type="secondary">
              선택된 카테고리: <Tag color="blue">{categoryOptions.find(c => c.value === category)?.label}</Tag>
            </Text>
            <Divider />
            <Radio.Group
              value={packageType}
              onChange={(e) => { setPackageType(e.target.value); resetSearch(); }}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {filteredPackageTypes.map((opt) => (
                  <Radio.Button
                    key={opt.value}
                    value={opt.value}
                    style={{ width: '100%', height: 'auto', padding: '12px 16px' }}
                  >
                    <div>
                      <span style={{ fontWeight: 'bold' }}>{opt.label}</span>
                      <span style={{ marginLeft: 12, fontSize: 12, color: '#666' }}>{opt.description}</span>
                    </div>
                  </Radio.Button>
                ))}
              </Space>
            </Radio.Group>
            <div style={{ marginTop: 24 }}>
              <Space>
                <Button onClick={() => setCurrentStep(0)}>이전</Button>
                <Button
                  type="primary"
                  onClick={() => setCurrentStep(shouldSkipLanguageVersion(packageType) ? 3 : 2)}
                >
                  다음
                </Button>
              </Space>
            </div>
          </Card>
        );

      case 2: {
        // 환경 설정 확인 단계 (읽기 전용)
        const langKey = getLanguageKey(packageType);
        const selectedVersion = langKey ? languageVersions[langKey] : '';
        const versionLabel = languageVersionOptions[packageType]?.find(
          v => v.value === selectedVersion
        )?.label || selectedVersion;
        const isPython = packageType === 'pip' || packageType === 'conda';

        // OS 레이블 매핑
        const osLabels: Record<string, string> = {
          any: '모든 OS',
          windows: 'Windows',
          macos: 'macOS',
          linux: 'Linux',
        };

        return (
          <Card>
            <Title level={5}>환경 설정 확인</Title>
            <Text type="secondary">
              설정 페이지에서 지정한 기본값이 적용됩니다.
            </Text>
            <Divider />

            <Alert
              message="설정에서 변경 가능"
              description={
                <span>
                  아래 값을 변경하려면 <a href="/settings" onClick={(e) => { e.preventDefault(); window.location.href = '/settings'; }}>설정 페이지</a>로 이동하세요.
                </span>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            {/* 언어 버전 - 읽기 전용 */}
            <div style={{ marginBottom: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                {isPython ? 'Python 버전' : packageType === 'npm' ? 'Node.js 버전' : 'Java 버전'}
              </Text>
              <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>
                {versionLabel || '미설정'}
              </Tag>
            </div>

            {/* 대상 OS - 읽기 전용 */}
            <div style={{ marginBottom: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>대상 운영체제</Text>
              <Tag color="green" style={{ fontSize: 14, padding: '4px 12px' }}>
                {osLabels[defaultTargetOS] || defaultTargetOS}
              </Tag>
            </div>

            {/* 아키텍처 - 읽기 전용 */}
            <div style={{ marginBottom: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>대상 아키텍처</Text>
              <Tag color="purple" style={{ fontSize: 14, padding: '4px 12px' }}>
                {defaultArchitecture}
              </Tag>
            </div>

            <div style={{ marginTop: 24 }}>
              <Space>
                <Button onClick={() => setCurrentStep(1)}>이전</Button>
                <Button type="primary" onClick={() => setCurrentStep(3)}>
                  다음
                </Button>
              </Space>
            </div>
          </Card>
        );
      }

      case 3: {
        const dropdownItems = suggestions.map((item) => ({
          key: item.name,
          label: (
            <div
              style={{ padding: '8px 0', cursor: 'pointer' }}
              onClick={() => handleSuggestionSelect(item)}
            >
              <div style={{ fontWeight: 'bold' }}>{item.name}</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {item.version} - {item.description || '설명 없음'}
              </div>
            </div>
          ),
        }));

        return (
          <Card>
            <Title level={5}>패키지를 검색하세요</Title>
            <Text type="secondary">
              <Tag color="blue">{packageTypeOptions.find(p => p.value === packageType)?.label}</Tag>
              패키지 검색 (2글자 이상 입력하면 자동 검색)
            </Text>
            <Divider />
            <Dropdown
              menu={{ items: dropdownItems }}
              open={showSuggestions && suggestions.length > 0}
              placement="bottomLeft"
              overlayStyle={{ width: '100%', maxWidth: 600 }}
            >
              <Input
                placeholder="패키지명을 입력하세요 (예: requests, lodash, nginx)"
                allowClear
                size="large"
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                suffix={searching ? <Spin size="small" /> : <SearchOutlined style={{ color: '#999' }} />}
                style={{ marginBottom: 16 }}
              />
            </Dropdown>

            {searchResults.length > 0 && (
              <>
                <Alert
                  message={`${searchResults.length}개의 패키지를 찾았습니다`}
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table
                  columns={columns}
                  dataSource={searchResults}
                  rowKey="name"
                  pagination={false}
                  size="middle"
                />
              </>
            )}

            {!searching && searchResults.length === 0 && (
              <Empty
                description="검색어를 입력하여 패키지를 찾아보세요"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}

            <div style={{ marginTop: 24 }}>
              <Button onClick={() => setCurrentStep(shouldSkipLanguageVersion(packageType) ? 1 : 2)}>이전</Button>
            </div>
          </Card>
        );
      }

      case 4:
        return (
          <Card>
            <Title level={5}>버전을 선택하세요</Title>
            {selectedPackage && (
              <>
                <Text type="secondary">
                  선택된 패키지: <Tag color="blue">{selectedPackage.name}</Tag>
                </Text>
                <Divider />

                <div style={{ marginBottom: 16 }}>
                  <Text strong>버전 선택</Text>
                  {loadingVersions ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin />
                      <div style={{ marginTop: 8 }}>버전 목록을 불러오는 중...</div>
                    </div>
                  ) : (
                    <Select
                      value={selectedVersion}
                      onChange={setSelectedVersion}
                      style={{ width: '100%', marginTop: 8 }}
                      size="large"
                      showSearch
                      optionFilterProp="label"
                      options={availableVersions.map((v, index) => ({
                        value: v,
                        label: index === 0 ? `${v} (최신)` : v,
                      }))}
                    />
                  )}
                  {!loadingVersions && availableVersions.length > 0 && (
                    <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                      총 {availableVersions.length}개 버전 사용 가능
                    </Text>
                  )}
                </div>

                {selectedPackage.description && (
                  <Alert
                    message="패키지 정보"
                    description={selectedPackage.description}
                    type="info"
                    showIcon
                    style={{ marginTop: 16 }}
                  />
                )}
              </>
            )}

            <div style={{ marginTop: 24 }}>
              <Space>
                <Button onClick={() => setCurrentStep(3)}>이전</Button>
                {libraryPackageTypes.includes(packageType) ? (
                  // 라이브러리 패키지: 바로 장바구니 추가
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    onClick={handleAddToCart}
                    disabled={!selectedVersion || loadingVersions}
                    size="large"
                  >
                    장바구니에 추가
                  </Button>
                ) : (
                  // OS/컨테이너 패키지: 아키텍처 선택 단계로 이동
                  <Button type="primary" onClick={() => setCurrentStep(5)} disabled={!selectedVersion || loadingVersions}>
                    다음
                  </Button>
                )}
              </Space>
            </div>
          </Card>
        );

      case 5:
        return (
          <Card>
            <Title level={5}>아키텍처를 선택하세요</Title>
            {selectedPackage && (
              <>
                <Text type="secondary">
                  <Tag color="blue">{selectedPackage.name}</Tag>
                  <Tag color="green">{selectedVersion}</Tag>
                </Text>
                <Divider />

                {shouldApplyDefaultOSArch(packageType) && (
                  <Alert
                    message="설정 기본값 적용됨"
                    description={`설정에서 지정한 기본 아키텍처(${defaultArchitecture})가 선택되었습니다. 필요시 변경할 수 있습니다.`}
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                {showArchWarning && (
                  <Alert
                    message="참고"
                    description="이 패키지 타입은 대부분 아키텍처에 독립적입니다. 특별한 경우가 아니면 기본값을 사용하세요."
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <div style={{ marginBottom: 16 }}>
                  <Text strong>대상 아키텍처</Text>
                  <Radio.Group
                    value={architecture}
                    onChange={(e) => setArchitecture(e.target.value)}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {archOptions.map((opt) => (
                        <Radio key={opt.value} value={opt.value} style={{ display: 'block' }}>
                          <span style={{ fontWeight: 'bold' }}>{opt.label}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>- {opt.description}</span>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </div>

                <Alert
                  message="선택 요약"
                  description={
                    <div>
                      <div><strong>카테고리:</strong> {categoryOptions.find(c => c.value === category)?.label}</div>
                      <div><strong>패키지 타입:</strong> {packageTypeOptions.find(p => p.value === packageType)?.label}</div>
                      {languageVersion && (
                        <div><strong>언어 버전:</strong> {languageVersionOptions[packageType]?.find(v => v.value === languageVersion)?.label || languageVersion}</div>
                      )}
                      <div><strong>패키지:</strong> {selectedPackage.name}</div>
                      <div><strong>버전:</strong> {selectedVersion}</div>
                      <div><strong>아키텍처:</strong> {architecture}</div>
                    </div>
                  }
                  type="success"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              </>
            )}

            <div style={{ marginTop: 24 }}>
              <Space>
                <Button onClick={() => setCurrentStep(4)}>이전</Button>
                <Button
                  type="primary"
                  icon={<ShoppingCartOutlined />}
                  onClick={handleAddToCart}
                  size="large"
                >
                  장바구니에 추가
                </Button>
              </Space>
            </div>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      <Title level={3}>패키지 검색</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        다운로드할 패키지를 단계별로 선택합니다. 선택 완료 후 장바구니에 추가됩니다.
      </Text>

      <Steps
        current={getDisplayStep()}
        items={stepItems}
        style={{ marginBottom: 24 }}
        size="small"
        responsive={false}
      />

      {renderCurrentStep()}
    </div>
  );
};

export default WizardPage;
