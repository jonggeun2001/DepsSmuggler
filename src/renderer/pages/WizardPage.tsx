import React, { useState, useCallback } from 'react';
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
  AutoComplete,
  Divider,
  Alert,
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

// 검색 결과 아이템
interface SearchResult {
  name: string;
  version: string;
  description?: string;
  versions?: string[];
}

// 단계별 컴포넌트 Props
interface StepProps {
  onNext: () => void;
  onPrev?: () => void;
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
  const [autoCompleteOptions, setAutoCompleteOptions] = useState<{ value: string }[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<SearchResult | null>(null);

  // Step 4: 버전
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);

  // Step 5: 아키텍처
  const [architecture, setArchitecture] = useState<Architecture>('x86_64');

  const { addItem, hasItem } = useCartStore();

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
    // 검색 결과 초기화
    resetSearch();
  };

  // 검색 초기화
  const resetSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setAutoCompleteOptions([]);
    setSelectedPackage(null);
    setSelectedVersion('');
    setAvailableVersions([]);
  };

  // 자동완성 검색 (디바운스)
  const handleAutoComplete = useCallback(async (value: string) => {
    if (!value.trim() || value.length < 2) {
      setAutoCompleteOptions([]);
      return;
    }

    try {
      let suggestions: string[];

      // Electron 환경에서는 IPC 사용
      if (window.electronAPI?.search?.suggest) {
        suggestions = await window.electronAPI.search.suggest(packageType, value);
      } else {
        // Mock 자동완성
        suggestions = [value, `${value}-core`, `${value}-utils`, `py${value}`];
      }

      setAutoCompleteOptions(suggestions.map((s) => ({ value: s })));
    } catch (error) {
      console.error('Autocomplete error:', error);
      // 에러 시 기본 제안
      setAutoCompleteOptions([{ value }]);
    }
  }, [packageType]);

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

      // Electron 환경에서는 IPC 사용
      if (window.electronAPI?.search?.packages) {
        const response = await window.electronAPI.search.packages(packageType, query);
        results = response.results;
      } else {
        // 브라우저 환경 또는 IPC 없을 때 Mock 데이터 사용
        await new Promise((resolve) => setTimeout(resolve, 800));
        results = getMockSearchResults(packageType, query);
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

  // Mock 검색 결과 생성
  const getMockSearchResults = (type: PackageType, query: string): SearchResult[] => {
    const baseVersions = ['2.0.0', '1.9.0', '1.8.5', '1.8.0', '1.7.0'];

    switch (type) {
      case 'pip':
      case 'conda':
        return [
          {
            name: query,
            version: '2.0.0',
            description: `${query} - Python 패키지`,
            versions: baseVersions,
          },
          {
            name: `${query}-extra`,
            version: '1.5.0',
            description: `${query} 확장 패키지`,
            versions: ['1.5.0', '1.4.0', '1.3.0'],
          },
        ];
      case 'maven':
        return [
          {
            name: `org.example:${query}`,
            version: '3.0.0',
            description: `${query} Maven 아티팩트`,
            versions: ['3.0.0', '2.5.0', '2.0.0'],
          },
        ];
      case 'npm':
        return [
          {
            name: query,
            version: '5.0.0',
            description: `${query} npm 패키지`,
            versions: ['5.0.0', '4.0.0', '3.0.0'],
          },
          {
            name: `@types/${query}`,
            version: '1.0.0',
            description: `TypeScript 타입 정의`,
            versions: ['1.0.0', '0.9.0'],
          },
        ];
      case 'docker':
        return [
          {
            name: query,
            version: 'latest',
            description: `${query} 공식 이미지`,
            versions: ['latest', '3.0', '2.0', '1.0'],
          },
          {
            name: `library/${query}`,
            version: 'alpine',
            description: `${query} Alpine 버전`,
            versions: ['alpine', 'slim', 'latest'],
          },
        ];
      default:
        return [
          {
            name: query,
            version: '1.0.0',
            description: `${query} 패키지`,
            versions: ['1.0.0', '0.9.0'],
          },
        ];
    }
  };

  // 패키지 선택
  const handleSelectPackage = (record: SearchResult) => {
    setSelectedPackage(record);
    setAvailableVersions(record.versions || [record.version]);
    setSelectedVersion(record.version);
    setCurrentStep(3); // 버전 선택 단계로
  };

  // 장바구니 추가
  const handleAddToCart = () => {
    if (!selectedPackage) return;

    if (hasItem(packageType, selectedPackage.name, selectedVersion)) {
      message.warning('이미 장바구니에 있는 패키지입니다');
      return;
    }

    addItem({
      type: packageType,
      name: selectedPackage.name,
      version: selectedVersion,
      arch: architecture,
      metadata: {
        description: selectedPackage.description,
        category,
      },
    });

    message.success(`${selectedPackage.name}@${selectedVersion}이(가) 장바구니에 추가되었습니다`);

    // 검색 단계로 돌아가서 추가 패키지 검색 가능
    resetSearch();
    setCurrentStep(2);
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

  // Step 1: 카테고리 선택
  const Step1Category: React.FC<StepProps> = ({ onNext }) => (
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
              style={{
                width: '100%',
                height: 'auto',
                padding: '16px',
                display: 'flex',
                alignItems: 'flex-start',
              }}
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
        <Button type="primary" onClick={onNext}>
          다음
        </Button>
      </div>
    </Card>
  );

  // Step 2: 패키지 타입 선택
  const Step2PackageType: React.FC<StepProps> = ({ onNext, onPrev }) => (
    <Card>
      <Title level={5}>패키지 관리자를 선택하세요</Title>
      <Text type="secondary">
        선택된 카테고리: <Tag color="blue">{categoryOptions.find(c => c.value === category)?.label}</Tag>
      </Text>
      <Divider />
      <Radio.Group
        value={packageType}
        onChange={(e) => {
          setPackageType(e.target.value);
          resetSearch();
        }}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          {filteredPackageTypes.map((opt) => (
            <Radio.Button
              key={opt.value}
              value={opt.value}
              style={{
                width: '100%',
                height: 'auto',
                padding: '12px 16px',
              }}
            >
              <div>
                <span style={{ fontWeight: 'bold' }}>{opt.label}</span>
                <span style={{ marginLeft: 12, fontSize: 12, color: '#666' }}>
                  {opt.description}
                </span>
              </div>
            </Radio.Button>
          ))}
        </Space>
      </Radio.Group>
      <div style={{ marginTop: 24 }}>
        <Space>
          <Button onClick={onPrev}>이전</Button>
          <Button type="primary" onClick={onNext}>
            다음
          </Button>
        </Space>
      </div>
    </Card>
  );

  // Step 3: 패키지 검색
  const Step3Search: React.FC<StepProps> = ({ onPrev }) => (
    <Card>
      <Title level={5}>패키지를 검색하세요</Title>
      <Text type="secondary">
        <Tag color="blue">{packageTypeOptions.find(p => p.value === packageType)?.label}</Tag>
        패키지 검색
      </Text>
      <Divider />
      <AutoComplete
        options={autoCompleteOptions}
        onSearch={handleAutoComplete}
        onSelect={(value) => {
          setSearchQuery(value);
          handleSearch(value);
        }}
        style={{ width: '100%', marginBottom: 16 }}
      >
        <Input.Search
          placeholder="패키지명을 입력하세요 (예: requests, lodash, nginx)"
          allowClear
          enterButton={<><SearchOutlined /> 검색</>}
          size="large"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onSearch={handleSearch}
          loading={searching}
        />
      </AutoComplete>

      {searching ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>검색 중...</div>
        </div>
      ) : searchResults.length > 0 ? (
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
      ) : (
        <Empty
          description="검색어를 입력하여 패키지를 찾아보세요"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}

      <div style={{ marginTop: 24 }}>
        <Button onClick={onPrev}>이전</Button>
      </div>
    </Card>
  );

  // Step 4: 버전 선택
  const Step4Version: React.FC<StepProps> = ({ onNext, onPrev }) => (
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
            <Select
              value={selectedVersion}
              onChange={setSelectedVersion}
              style={{ width: '100%', marginTop: 8 }}
              size="large"
              options={availableVersions.map((v) => ({
                value: v,
                label: v === availableVersions[0] ? `${v} (최신)` : v,
              }))}
            />
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
          <Button onClick={onPrev}>이전</Button>
          <Button type="primary" onClick={onNext} disabled={!selectedVersion}>
            다음
          </Button>
        </Space>
      </div>
    </Card>
  );

  // Step 5: 아키텍처 선택
  const Step5Architecture: React.FC<StepProps> = ({ onPrev }) => {
    // 컨테이너나 noarch 패키지는 아키텍처 선택 불필요할 수 있음
    const showArchWarning = category === 'container' || packageType === 'pip' || packageType === 'npm';

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
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                        - {opt.description}
                      </span>
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
            <Button onClick={onPrev}>이전</Button>
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
  };

  // 단계 정의
  const steps = [
    {
      title: '카테고리',
      icon: <AppstoreOutlined />,
      content: <Step1Category onNext={() => setCurrentStep(1)} />,
    },
    {
      title: '패키지 타입',
      icon: <CodeOutlined />,
      content: (
        <Step2PackageType
          onNext={() => setCurrentStep(2)}
          onPrev={() => setCurrentStep(0)}
        />
      ),
    },
    {
      title: '검색',
      icon: <SearchOutlined />,
      content: <Step3Search onPrev={() => setCurrentStep(1)} />,
    },
    {
      title: '버전',
      icon: <Tag />,
      content: (
        <Step4Version
          onNext={() => setCurrentStep(4)}
          onPrev={() => setCurrentStep(2)}
        />
      ),
    },
    {
      title: '아키텍처',
      icon: <CloudServerOutlined />,
      content: <Step5Architecture onPrev={() => setCurrentStep(3)} />,
    },
  ];

  return (
    <div>
      <Title level={3}>패키지 검색</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        다운로드할 패키지를 단계별로 선택합니다. 선택 완료 후 장바구니에 추가됩니다.
      </Text>

      <Steps
        current={currentStep}
        items={steps.map((s) => ({
          title: s.title,
          icon: s.icon,
        }))}
        style={{ marginBottom: 24 }}
        size="small"
        responsive={false}
      />

      <div>{steps[currentStep].content}</div>
    </div>
  );
};

export default WizardPage;
