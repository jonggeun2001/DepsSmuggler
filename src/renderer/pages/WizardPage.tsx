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
  SettingOutlined,
} from '@ant-design/icons';
import { useCartStore, PackageType, Architecture } from '../stores/cartStore';
import { useSettingsStore, DockerRegistry } from '../stores/settingsStore';

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
  { value: 'npm', label: 'npm', category: 'library', description: 'Node.js 패키지' },
  { value: 'yum', label: 'YUM', category: 'os', description: 'RHEL/CentOS/Fedora 패키지' },
  { value: 'apt', label: 'APT', category: 'os', description: 'Ubuntu/Debian 패키지' },
  { value: 'apk', label: 'APK', category: 'os', description: 'Alpine Linux 패키지' },
  { value: 'docker', label: 'Docker', category: 'container', description: 'Docker Hub 이미지' },
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

// Docker 레지스트리 옵션
const dockerRegistryOptions: { value: DockerRegistry; label: string; description: string }[] = [
  { value: 'docker.io', label: 'Docker Hub', description: '공식 Docker Hub 레지스트리' },
  { value: 'ghcr.io', label: 'GitHub Container Registry', description: 'GitHub 컨테이너 레지스트리' },
  { value: 'ecr', label: 'Amazon ECR Public', description: 'AWS 퍼블릭 컨테이너 레지스트리' },
  { value: 'quay.io', label: 'Quay.io', description: 'Red Hat Quay 레지스트리' },
  { value: 'custom', label: '커스텀 레지스트리', description: '직접 레지스트리 URL 입력' },
];

// 검색 결과 아이템
interface SearchResult {
  name: string;
  version: string;
  description?: string;
  versions?: string[];
  // OS 패키지용 추가 필드
  downloadUrl?: string;
  repository?: { baseUrl: string; name?: string };
  location?: string;
  architecture?: string;
  // Docker 이미지용 추가 필드
  registry?: string;
  isOfficial?: boolean;
  pullCount?: number;
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

  // 드롭다운 hover 상태 (Windows Electron 스크롤 문제 해결용)
  const [isOverDropdown, setIsOverDropdown] = useState(false);

  const { addItem, hasItem } = useCartStore();
  const {
    languageVersions,
    defaultArchitecture,
    defaultTargetOS,
    condaChannel,
    yumDistribution,
    aptDistribution,
    apkDistribution,
    dockerRegistry: defaultDockerRegistry,
    dockerCustomRegistry,
    dockerArchitecture,
  } = useSettingsStore();

  // Docker 레지스트리 상태
  const [dockerRegistry, setDockerRegistry] = useState<DockerRegistry>(defaultDockerRegistry);
  const [customRegistryUrl, setCustomRegistryUrl] = useState(dockerCustomRegistry);

  // 라이브러리 패키지 타입 (설정 기본값 적용 대상)
  const libraryPackageTypes: PackageType[] = ['pip', 'conda', 'maven', 'npm'];

  // OS 패키지 타입 (배포판별 설정 아키텍처 적용)
  const osPackageTypes: PackageType[] = ['yum', 'apt', 'apk'];

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
    } else if (osPackageTypes.includes(packageType)) {
      // OS 패키지: 각 배포판의 설정된 아키텍처 적용
      if (packageType === 'yum') {
        setArchitecture(yumDistribution.architecture as Architecture);
      } else if (packageType === 'apt') {
        setArchitecture(aptDistribution.architecture as Architecture);
      } else if (packageType === 'apk') {
        setArchitecture(apkDistribution.architecture as Architecture);
      }
    } else if (packageType === 'docker') {
      // Docker: 설정에서 가져온 Docker 아키텍처 적용
      setArchitecture(dockerArchitecture as Architecture);
    }
  }, [packageType, defaultArchitecture, yumDistribution.architecture, aptDistribution.architecture, apkDistribution.architecture, dockerArchitecture]);

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

  // 브라우저에서 Docker 이미지 검색 (레지스트리별)
  const searchDockerImage = async (query: string, registry: DockerRegistry = 'docker.io'): Promise<SearchResult[]> => {
    try {
      const registryParam = registry === 'custom' && customRegistryUrl
        ? customRegistryUrl
        : registry;
      const response = await fetch(`/api/docker/search?q=${encodeURIComponent(query)}&registry=${encodeURIComponent(registryParam)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      // 검색 결과에 레지스트리 정보 추가
      return (data.results || []).map((item: SearchResult) => ({
        ...item,
        registry: registryParam,
      }));
    } catch (error) {
      console.error('Docker search error:', error);
      return [];
    }
  };

  // Docker 이미지 태그 목록 조회
  const fetchDockerTags = async (imageName: string, registry: DockerRegistry = 'docker.io'): Promise<string[]> => {
    try {
      const registryParam = registry === 'custom' && customRegistryUrl
        ? customRegistryUrl
        : registry;
      const response = await fetch(`/api/docker/tags?image=${encodeURIComponent(imageName)}&registry=${encodeURIComponent(registryParam)}`);
      if (!response.ok) {
        return ['latest'];
      }
      const data = await response.json();
      return data.tags || ['latest'];
    } catch (error) {
      console.error('Docker tags fetch error:', error);
      return ['latest'];
    }
  };

  // 브라우저에서 OS 패키지 API로 검색 (YUM, APT, APK)
  const searchOSPackage = async (type: PackageType, query: string): Promise<SearchResult[]> => {
    try {
      // 패키지 타입에 따라 설정에서 배포판 정보 가져오기
      const getDistributionInfo = (pkgType: string) => {
        switch (pkgType) {
          case 'yum':
            return {
              id: yumDistribution.id,
              name: yumDistribution.id, // 서버에서 getDistributionById로 조회
              osType: 'linux',
              packageManager: 'yum',
              architecture: yumDistribution.architecture,
            };
          case 'apt':
            return {
              id: aptDistribution.id,
              name: aptDistribution.id,
              osType: 'linux',
              packageManager: 'apt',
              architecture: aptDistribution.architecture,
            };
          case 'apk':
            return {
              id: apkDistribution.id,
              name: apkDistribution.id,
              osType: 'linux',
              packageManager: 'apk',
              architecture: apkDistribution.architecture,
            };
          default:
            return null;
        }
      };

      const distributionInfo = getDistributionInfo(type);
      if (!distributionInfo) {
        console.warn(`Unknown OS package type: ${type}`);
        return [];
      }

      const response = await fetch('/api/os/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          distribution: {
            id: distributionInfo.id,
            name: distributionInfo.name,
            osType: distributionInfo.osType,
            packageManager: distributionInfo.packageManager,
          },
          architecture: distributionInfo.architecture,
          matchType: 'contains',
          limit: 50,
        }),
      });

      if (!response.ok) {
        console.error(`OS package search failed: ${response.statusText}`);
        return [];
      }

      const data = await response.json();

      // OS 패키지 결과를 SearchResult 형식으로 변환 (그룹화된 결과 처리)
      // API 응답: { packages: OSPackageSearchResult[], totalCount, hasMore }
      // OSPackageSearchResult: { name, versions: OSPackageInfo[], latest: OSPackageInfo }
      return (data.packages || []).map((pkg: {
        name: string;
        versions: Array<{
          name: string;
          version: string;
          description?: string;
          summary?: string;
          downloadUrl?: string;
          repository?: { baseUrl: string; name?: string };
          location?: string;
          architecture?: string;
        }>;
        latest: {
          name: string;
          version: string;
          description?: string;
          summary?: string;
          downloadUrl?: string;
          repository?: { baseUrl: string; name?: string };
          location?: string;
          architecture?: string;
        };
      }) => ({
        name: pkg.name,
        version: pkg.latest.version,
        description: pkg.latest.summary || pkg.latest.description || '',
        versions: pkg.versions.map(v => v.version), // 버전 목록 포함
        downloadUrl: pkg.latest.downloadUrl,
        repository: pkg.latest.repository,
        location: pkg.latest.location,
        architecture: pkg.latest.architecture,
      }));
    } catch (error) {
      console.error(`${type} search error:`, error);
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
        return searchMavenPackage(query);
      case 'npm':
        return searchNpmPackage(query);
      case 'docker':
        return searchDockerImage(query, dockerRegistry);
      case 'yum':
      case 'apt':
      case 'apk':
        return searchOSPackage(type, query);
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

      // OS 패키지 타입인 경우 별도의 OS API 사용
      const isOSPackage = ['yum', 'apt', 'apk'].includes(packageType);

      if (isOSPackage && window.electronAPI?.os?.search) {
        // OS 패키지: electronAPI.os.search 사용
        const getDistributionInfo = () => {
          switch (packageType) {
            case 'yum':
              return { id: yumDistribution.id, architecture: yumDistribution.architecture, packageManager: 'yum' };
            case 'apt':
              return { id: aptDistribution.id, architecture: aptDistribution.architecture, packageManager: 'apt' };
            case 'apk':
              return { id: apkDistribution.id, architecture: apkDistribution.architecture, packageManager: 'apk' };
            default:
              return null;
          }
        };

        const distInfo = getDistributionInfo();
        if (!distInfo) {
          throw new Error(`지원하지 않는 OS 패키지 타입: ${packageType}`);
        }

        const response = await window.electronAPI.os.search({
          query,
          distribution: {
            id: distInfo.id,
            name: distInfo.id,
            osType: 'linux',
            packageManager: distInfo.packageManager,
          },
          architecture: distInfo.architecture as import('../../core/downloaders/os/types').OSArchitecture,
          matchType: 'partial',
          limit: 50,
        });

        // OS 패키지 결과를 SearchResult 형식으로 변환 (메타데이터 포함)
        results = ((response.packages || []) as Array<{
          name: string;
          version: string;
          description?: string;
          summary?: string;
          repository?: { baseUrl: string; name?: string; id?: string };
          location?: string;
          architecture?: string;
        }>).map(pkg => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.summary || pkg.description || '',
          repository: pkg.repository,
          location: pkg.location,
          architecture: pkg.architecture,
        }));
      } else if (window.electronAPI?.search?.packages) {
        // 일반 패키지: electronAPI.search.packages 사용
        let searchOptions: { channel?: string; registry?: string } | undefined;

        if (packageType === 'conda') {
          searchOptions = { channel: condaChannel };
        } else if (packageType === 'docker') {
          const registryValue = dockerRegistry === 'custom' && customRegistryUrl
            ? customRegistryUrl
            : dockerRegistry;
          searchOptions = { registry: registryValue };
        }

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
      const errorMessage = error instanceof Error ? error.message : '검색 중 오류가 발생했습니다';
      message.error(errorMessage);
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
    setCurrentStep(3); // 버전 선택 단계로 이동
    setLoadingVersions(true);

    try {
      if (window.electronAPI?.search?.versions) {
        // 패키지 타입별 옵션 전달
        let searchOptions: { channel?: string; registry?: string } | undefined;

        if (packageType === 'conda') {
          searchOptions = { channel: condaChannel };
        } else if (packageType === 'docker') {
          const registryValue = dockerRegistry === 'custom' && customRegistryUrl
            ? customRegistryUrl
            : dockerRegistry;
          searchOptions = { registry: registryValue };
        }

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
      } else if (packageType === 'maven') {
        // 브라우저 환경: Maven 버전 API 직접 호출
        try {
          const response = await fetch(`/api/maven/versions?package=${encodeURIComponent(record.name)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.versions && data.versions.length > 0) {
              setAvailableVersions(data.versions);
              setSelectedVersion(data.versions[0]);
            } else {
              setAvailableVersions([record.version]);
            }
          } else {
            setAvailableVersions([record.version]);
          }
        } catch (err) {
          console.error('Maven version fetch error:', err);
          setAvailableVersions([record.version]);
        }
      } else if (packageType === 'docker') {
        // Docker: 태그 목록 조회
        const tags = await fetchDockerTags(record.name, dockerRegistry);
        if (tags.length > 0) {
          setAvailableVersions(tags);
          // latest가 있으면 기본 선택, 아니면 첫 번째
          const defaultTag = tags.includes('latest') ? 'latest' : tags[0];
          setSelectedVersion(defaultTag);
        } else {
          setAvailableVersions(['latest']);
          setSelectedVersion('latest');
        }
      } else if (['yum', 'apt', 'apk'].includes(packageType)) {
        // OS 패키지: 검색 결과에 이미 버전 목록이 포함됨 (그룹화된 결과)
        if (record.versions && record.versions.length > 0) {
          setAvailableVersions(record.versions);
          setSelectedVersion(record.versions[0]); // 최신 버전 선택
        } else {
          setAvailableVersions([record.version]);
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

    // 아키텍처 결정 로직
    const getEffectiveArchitecture = (): Architecture => {
      // 라이브러리 패키지: 설정의 기본 아키텍처 사용
      if (libraryPackageTypes.includes(packageType)) {
        return defaultArchitecture as Architecture;
      }
      // OS 패키지: 각 배포판의 설정된 아키텍처 사용
      if (packageType === 'yum') return yumDistribution.architecture as Architecture;
      if (packageType === 'apt') return aptDistribution.architecture as Architecture;
      if (packageType === 'apk') return apkDistribution.architecture as Architecture;
      // Docker: 설정의 Docker 아키텍처 사용
      if (packageType === 'docker') return dockerArchitecture as Architecture;
      // 기타: 수동 선택된 아키텍처 사용 (폴백)
      return architecture;
    };
    const effectiveArch = getEffectiveArchitecture();

    // Docker 이미지: 레지스트리 정보 포함
    const dockerMetadata = packageType === 'docker' ? {
      registry: dockerRegistry === 'custom' ? customRegistryUrl : dockerRegistry,
      isOfficial: selectedPackage.isOfficial,
      pullCount: selectedPackage.pullCount,
    } : {};

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
        // Docker 이미지 메타데이터
        ...dockerMetadata,
      },
      // OS 패키지 메타데이터 포함
      downloadUrl: selectedPackage.downloadUrl,
      repository: selectedPackage.repository,
      location: selectedPackage.location,
    });

    message.success(`${selectedPackage.name}@${selectedVersion}이(가) 장바구니에 추가되었습니다`);
    resetSearch();
    setCurrentStep(2); // 검색 단계로 이동
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

  // 단계 정보 (환경 확인 단계 제거 - 검색 화면에 인라인 표시)
  const getStepItems = () => {
    return [
      { title: '카테고리', icon: <AppstoreOutlined /> },
      { title: '패키지 타입', icon: <CodeOutlined /> },
      { title: '검색', icon: <SearchOutlined /> },
      { title: '버전', icon: <Tag /> },
    ];
  };

  const stepItems = getStepItems();

  // 현재 표시할 단계 인덱스 계산 (환경확인 단계 제거됨)
  // 모든 패키지 타입: 0(카테고리) -> 1(패키지타입) -> 2(검색) -> 3(버전)
  const getDisplayStep = () => {
    return currentStep;
  };

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
                  onClick={() => setCurrentStep(2)}
                >
                  다음
                </Button>
              </Space>
            </div>
          </Card>
        );

      case 2: {
        // 환경 정보 바 (라이브러리 패키지용)
        const renderEnvironmentInfoBar = () => {
          if (!libraryPackageTypes.includes(packageType)) return null;

          const langKey = getLanguageKey(packageType);
          const langVersion = langKey ? languageVersions[langKey] : '';
          const versionLabel = languageVersionOptions[packageType]?.find(
            v => v.value === langVersion
          )?.label || langVersion;

          // OS 레이블 매핑
          const osLabels: Record<string, string> = {
            any: '모든 OS',
            windows: 'Windows',
            macos: 'macOS',
            linux: 'Linux',
          };

          return (
            <div style={{
              background: '#fafafa',
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <Space size={4} wrap>
                <SettingOutlined style={{ color: '#999', marginRight: 4 }} />
                {versionLabel && <Tag color="blue">{versionLabel}</Tag>}
                <Tag color="green">{osLabels[defaultTargetOS] || defaultTargetOS}</Tag>
                <Tag color="purple">{defaultArchitecture}</Tag>
              </Space>
              <a
                href="/settings"
                onClick={(e) => { e.preventDefault(); window.location.href = '/settings'; }}
                style={{ fontSize: 12, color: '#1890ff' }}
              >
                설정 변경
              </a>
            </div>
          );
        };

        const dropdownItems = suggestions.map((item) => ({
          key: item.name,
          label: (
            <div
              style={{ padding: '8px 0', cursor: 'pointer' }}
              onClick={() => handleSuggestionSelect(item)}
              onMouseEnter={() => setIsOverDropdown(true)}
              onMouseLeave={() => setIsOverDropdown(false)}
            >
              <div style={{ fontWeight: 'bold' }}>
                {item.name}
                {item.isOfficial && <Tag color="gold" style={{ marginLeft: 8 }}>공식</Tag>}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {packageType === 'docker' ? (
                  <>
                    {item.description || '설명 없음'}
                    {item.pullCount !== undefined && (
                      <span style={{ marginLeft: 8 }}>📥 {item.pullCount.toLocaleString()}</span>
                    )}
                  </>
                ) : (
                  <>{item.version} - {item.description || '설명 없음'}</>
                )}
              </div>
            </div>
          ),
        }));

        // Docker 전용 검색 결과 컬럼
        const dockerColumns = [
          {
            title: '이미지명',
            dataIndex: 'name',
            key: 'name',
            render: (name: string, record: SearchResult) => (
              <Space>
                <Text strong>{name}</Text>
                {record.isOfficial && <Tag color="gold">공식</Tag>}
              </Space>
            ),
          },
          {
            title: '설명',
            dataIndex: 'description',
            key: 'description',
            ellipsis: true,
          },
          {
            title: 'Pull 수',
            dataIndex: 'pullCount',
            key: 'pullCount',
            width: 120,
            render: (count: number) => count ? count.toLocaleString() : '-',
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

        return (
          <Card>
            <Title level={5}>
              {packageType === 'docker' ? '컨테이너 이미지를 검색하세요' : '패키지를 검색하세요'}
            </Title>
            <Text type="secondary">
              <Tag color="blue">{packageTypeOptions.find(p => p.value === packageType)?.label}</Tag>
              {packageType === 'docker' ? '이미지 검색' : '패키지 검색'} (2글자 이상 입력하면 자동 검색)
            </Text>
            <Divider />

            {/* 라이브러리 패키지: 환경 정보 바 */}
            {renderEnvironmentInfoBar()}

            {/* Docker 타입일 때 레지스트리 선택 UI */}
            {packageType === 'docker' && (
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>레지스트리 선택</Text>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Select
                    value={dockerRegistry}
                    onChange={(value) => {
                      setDockerRegistry(value);
                      resetSearch();
                    }}
                    style={{ width: '100%' }}
                    options={dockerRegistryOptions.map(opt => ({
                      value: opt.value,
                      label: (
                        <Space>
                          <span>{opt.label}</span>
                          <Text type="secondary" style={{ fontSize: 12 }}>{opt.description}</Text>
                        </Space>
                      ),
                    }))}
                  />
                  {dockerRegistry === 'custom' && (
                    <Input
                      placeholder="레지스트리 URL을 입력하세요 (예: registry.example.com)"
                      value={customRegistryUrl}
                      onChange={(e) => setCustomRegistryUrl(e.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </Space>
                {dockerRegistry !== 'docker.io' && (
                  <Alert
                    message="참고"
                    description={
                      dockerRegistry === 'custom'
                        ? '커스텀 레지스트리는 카탈로그 API를 통해 이미지 목록을 가져옵니다. 이미지명을 정확히 입력하세요.'
                        : `${dockerRegistryOptions.find(r => r.value === dockerRegistry)?.label}는 카탈로그 API를 통해 검색합니다. Docker Hub와 달리 검색 기능이 제한될 수 있습니다.`
                    }
                    type="info"
                    showIcon
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>
            )}

            <Dropdown
              menu={{ items: dropdownItems, style: { maxHeight: 300, overflowY: 'auto' } }}
              open={showSuggestions && suggestions.length > 0}
              placement="bottomLeft"
              autoAdjustOverflow={false}
              overlayStyle={{ width: '100%', maxWidth: 600 }}
              dropdownRender={(menu) => (
                <div
                  onMouseEnter={() => setIsOverDropdown(true)}
                  onMouseLeave={() => setIsOverDropdown(false)}
                >
                  {menu}
                </div>
              )}
            >
              <Input
                placeholder={packageType === 'docker'
                  ? '이미지명을 입력하세요 (예: nginx, python, node)'
                  : '패키지명을 입력하세요 (예: requests, lodash, nginx)'}
                allowClear
                size="large"
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={() => {
                  // 드롭다운 위에 마우스가 있으면 blur 무시 (Windows Electron 스크롤 문제 해결)
                  if (!isOverDropdown) {
                    setTimeout(() => setShowSuggestions(false), 200);
                  }
                }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                suffix={searching ? <Spin size="small" /> : <SearchOutlined style={{ color: '#999' }} />}
                style={{ marginBottom: 16 }}
              />
            </Dropdown>

            {searchResults.length > 0 && (
              <>
                <Alert
                  message={`${searchResults.length}개의 ${packageType === 'docker' ? '이미지' : '패키지'}를 찾았습니다`}
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table
                  columns={packageType === 'docker' ? dockerColumns : columns}
                  dataSource={searchResults}
                  rowKey="name"
                  pagination={false}
                  size="middle"
                />
              </>
            )}

            {!searching && searchResults.length === 0 && (
              <Empty
                description={packageType === 'docker'
                  ? '이미지명을 입력하여 컨테이너 이미지를 찾아보세요'
                  : '검색어를 입력하여 패키지를 찾아보세요'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}

            <div style={{ marginTop: 24 }}>
              <Button onClick={() => setCurrentStep(1)}>이전</Button>
            </div>
          </Card>
        );
      }

      case 3:
        return (
          <Card>
            <Title level={5}>
              {packageType === 'docker' ? '태그를 선택하세요' : '버전을 선택하세요'}
            </Title>
            {selectedPackage && (
              <>
                <Text type="secondary">
                  선택된 {packageType === 'docker' ? '이미지' : '패키지'}: <Tag color="blue">{selectedPackage.name}</Tag>
                  {packageType === 'docker' && selectedPackage.registry && (
                    <Tag color="purple" style={{ marginLeft: 4 }}>
                      {dockerRegistryOptions.find(r => r.value === selectedPackage.registry)?.label || selectedPackage.registry}
                    </Tag>
                  )}
                </Text>
                <Divider />

                <div style={{ marginBottom: 16 }}>
                  <Text strong>{packageType === 'docker' ? '태그 선택' : '버전 선택'}</Text>
                  {loadingVersions ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin />
                      <div style={{ marginTop: 8 }}>
                        {packageType === 'docker' ? '태그 목록을 불러오는 중...' : '버전 목록을 불러오는 중...'}
                      </div>
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
                        label: packageType === 'docker'
                          ? (v === 'latest' ? `${v} (권장)` : v)
                          : (index === 0 ? `${v} (최신)` : v),
                      }))}
                    />
                  )}
                  {!loadingVersions && availableVersions.length > 0 && (
                    <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                      총 {availableVersions.length}개 {packageType === 'docker' ? '태그' : '버전'} 사용 가능
                    </Text>
                  )}
                </div>

                {selectedPackage.description && (
                  <Alert
                    message={packageType === 'docker' ? '이미지 정보' : '패키지 정보'}
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
                <Button onClick={() => setCurrentStep(2)}>이전</Button>
                {/* 모든 패키지 타입: 바로 장바구니 추가 (아키텍처는 설정값 사용) */}
                <Button
                  type="primary"
                  icon={<ShoppingCartOutlined />}
                  onClick={handleAddToCart}
                  disabled={!selectedVersion || loadingVersions}
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
