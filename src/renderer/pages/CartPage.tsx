import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Popconfirm,
  Empty,
  Card,
  Upload,
  message,
  Modal,
  Input,
  Select,
  Radio,
  Divider,
  Statistic,
  Row,
  Col,
  Tabs,
  Alert,
  Spin,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  DeleteOutlined,
  ClearOutlined,
  DownloadOutlined,
  UploadOutlined,
  SearchOutlined,
  FileTextOutlined,
  InboxOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { useCartStore, CartItem, PackageType } from '../stores/cartStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DependencyTree } from '../components';
import { DependencyResolutionResult, DependencyNode, PackageType as CorePackageType } from '../../types';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

// 패키지 타입별 색상
const typeColors: Record<PackageType, string> = {
  pip: 'blue',
  conda: 'green',
  maven: 'orange',
  gradle: 'gold',
  npm: 'red',
  yum: 'purple',
  apt: 'cyan',
  apk: 'magenta',
  docker: 'geekblue',
};

// 패키지 타입별 예상 크기 (MB)
// 참고: 실제 패키지 크기가 아닌 타입별 평균 추정치입니다.
// 실제 크기는 다운로드 시 메타데이터에서 확인됩니다.
const estimatedSizePerPackage: Record<PackageType, number> = {
  pip: 2.5,
  conda: 5.0,
  maven: 3.0,
  gradle: 3.5,
  npm: 1.5,
  yum: 10.0,
  apt: 8.0,
  apk: 4.0,
  docker: 150.0,
};

// 출력 형식 옵션
const outputFormatOptions = [
  { value: 'zip', label: 'ZIP 압축 파일', description: '단일 압축 파일 (.zip)' },
  { value: 'tar.gz', label: 'TAR.GZ 파일', description: 'Linux 친화적 압축 (.tar.gz)' },
  { value: 'mirror', label: '오프라인 미러', description: '로컬 저장소 구조' },
];

// 전달 방식 옵션
const deliveryMethodOptions = [
  { value: 'local', label: '로컬 저장', description: 'USB, 수동 전달용' },
  { value: 'email', label: '메일 발송', description: 'SMTP 설정 필요' },
];

const CartPage: React.FC = () => {
  const navigate = useNavigate();
  const { items, removeItem, clearCart, addItem } = useCartStore();
  const settings = useSettingsStore();

  // 모달 상태
  const [textInputModalOpen, setTextInputModalOpen] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');
  const [textInputType, setTextInputType] = useState<'requirements' | 'pom' | 'package'>('requirements');

  // 다운로드 옵션 모달
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);
  const [outputFormat, setOutputFormat] = useState<string>('zip');
  const [deliveryMethod, setDeliveryMethod] = useState<string>('local');
  const [includeScript, setIncludeScript] = useState(true);

  // 의존성 트리 모달
  const [dependencyTreeModalOpen, setDependencyTreeModalOpen] = useState(false);
  const [dependencyData, setDependencyData] = useState<DependencyResolutionResult | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);

  // 예상 다운로드 크기 계산
  const estimatedSize = useMemo(() => {
    return items.reduce((total, item) => {
      return total + (estimatedSizePerPackage[item.type] || 2);
    }, 0);
  }, [items]);

  // 의존성 트리 로드 함수
  const loadDependencyTree = useCallback(async () => {
    if (items.length === 0) {
      setDependencyData(null);
      return;
    }

    setLoadingDeps(true);
    try {
      // 장바구니 아이템을 DownloadPackage 형식으로 변환
      const packages = items.map((item, index) => ({
        id: item.id || `pkg-${index}`,
        type: item.type,
        name: item.name,
        version: item.version,
        architecture: item.arch,
      }));

      let result: {
        originalPackages: unknown[];
        allPackages: unknown[];
        dependencyTrees?: unknown[];
        failedPackages?: unknown[];
      };

      // Electron 환경 또는 Vite dev 서버 환경에 따라 API 호출
      const resolverOptions = {
        targetOS: settings.defaultTargetOS || 'any',
      };

      if (window.electronAPI?.dependency?.resolve) {
        // Electron 환경
        result = await window.electronAPI.dependency.resolve(packages, resolverOptions);
      } else {
        // Vite dev 서버 환경
        const response = await fetch('/api/dependency/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages, options: resolverOptions }),
        });
        if (!response.ok) {
          throw new Error(`의존성 해결 실패: ${response.statusText}`);
        }
        result = await response.json();
      }

      // 의존성 트리 결과 처리
      const dependencyTrees = result.dependencyTrees as DependencyResolutionResult[] | undefined;

      if (dependencyTrees && dependencyTrees.length > 0) {
        if (dependencyTrees.length === 1) {
          // 단일 패키지인 경우 그대로 사용
          setDependencyData(dependencyTrees[0]);
        } else {
          // 여러 패키지인 경우 가상 루트 아래에 병합
          const mergedRoot: DependencyNode = {
            package: {
              type: 'pip' as CorePackageType,
              name: '선택된 패키지',
              version: '',
            },
            dependencies: dependencyTrees.map((tree) => tree.root),
            optional: false,
          };

          // 모든 패키지의 flatList 병합 (중복 제거)
          const allFlatList = dependencyTrees.flatMap((tree) => tree.flatList);
          const uniqueFlatList = allFlatList.filter(
            (pkg, index, self) =>
              self.findIndex((p) => p.type === pkg.type && p.name === pkg.name && p.version === pkg.version) === index
          );

          setDependencyData({
            root: mergedRoot,
            flatList: uniqueFlatList,
            conflicts: [],
            totalSize: undefined,
          });
        }
      } else {
        // 의존성 트리가 없는 경우 기본 구조 생성 (장바구니 아이템만)
        const createNode = (item: CartItem): DependencyNode => ({
          package: {
            type: item.type as CorePackageType,
            name: item.name,
            version: item.version,
            arch: item.arch as 'x86_64' | 'arm64' | 'i386' | 'noarch' | undefined,
          },
          dependencies: [],
          optional: false,
        });

        const rootNode: DependencyNode = items.length === 1
          ? createNode(items[0])
          : {
              package: {
                type: 'pip' as CorePackageType,
                name: '선택된 패키지',
                version: '',
              },
              dependencies: items.map(createNode),
              optional: false,
            };

        setDependencyData({
          root: rootNode,
          flatList: items.map((item) => ({
            type: item.type as CorePackageType,
            name: item.name,
            version: item.version,
          })),
          conflicts: [],
          totalSize: estimatedSize * 1024 * 1024,
        });
      }
    } catch (error) {
      console.error('의존성 트리 로드 실패:', error);
      message.error('의존성 트리를 불러오는데 실패했습니다');
      setDependencyData(null);
    } finally {
      setLoadingDeps(false);
    }
  }, [items, estimatedSize, settings.defaultTargetOS]);

  // 의존성 트리 보기 핸들러
  const handleShowDependencyTree = useCallback(async () => {
    setDependencyTreeModalOpen(true);
    await loadDependencyTree();
  }, [loadDependencyTree]);

  // 크기 포맷팅
  const formatSize = (sizeMB: number): string => {
    if (sizeMB >= 1024) {
      return `${(sizeMB / 1024).toFixed(2)} GB`;
    }
    return `${sizeMB.toFixed(2)} MB`;
  };

  // 파일 업로드 처리
  const handleFileUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      parsePackageFile(file.name, content);
    };
    reader.readAsText(file);
    return false; // 자동 업로드 방지
  };

  // 드래그 앤 드롭 설정
  const draggerProps: UploadProps = {
    name: 'file',
    multiple: true,
    accept: '.txt,.xml,.json',
    beforeUpload: handleFileUpload,
    showUploadList: false,
  };

  // 패키지 파일 파싱
  const parsePackageFile = (filename: string, content: string) => {
    let type: PackageType = 'pip';
    let packages: { name: string; version: string }[] = [];

    if (filename === 'requirements.txt' || filename.endsWith('.txt')) {
      type = 'pip';
      packages = parseRequirementsTxt(content);
    } else if (filename === 'pom.xml' || filename.endsWith('.xml')) {
      type = 'maven';
      packages = parsePomXml(content);
    } else if (filename === 'package.json' || filename.endsWith('.json')) {
      type = 'npm';
      packages = parsePackageJson(content);
    }

    addParsedPackages(type, packages);
  };

  // requirements.txt 파싱
  const parseRequirementsTxt = (content: string): { name: string; version: string }[] => {
    return content
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('-'))
      .map((line) => {
        // 다양한 버전 지정 패턴 처리
        const match = line.trim().match(/^([a-zA-Z0-9._-]+)(?:\[.*?\])?(?:([=<>!~]+)(.+))?$/);
        if (match) {
          return { name: match[1], version: match[3]?.trim() || 'latest' };
        }
        return null;
      })
      .filter(Boolean) as { name: string; version: string }[];
  };

  // pom.xml 파싱
  const parsePomXml = (content: string): { name: string; version: string }[] => {
    const packages: { name: string; version: string }[] = [];
    const depRegex =
      /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?/g;
    let match;
    while ((match = depRegex.exec(content)) !== null) {
      packages.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3] || 'latest',
      });
    }
    return packages;
  };

  // package.json 파싱
  const parsePackageJson = (content: string): { name: string; version: string }[] => {
    try {
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return Object.entries(deps).map(([name, version]) => ({
        name,
        version: (version as string).replace(/^[\^~]/, ''),
      }));
    } catch {
      message.error('package.json 파싱 실패');
      return [];
    }
  };

  // 파싱된 패키지 추가
  const addParsedPackages = (type: PackageType, packages: { name: string; version: string }[]) => {
    if (packages.length === 0) {
      message.warning('파싱된 패키지가 없습니다');
      return;
    }

    let addedCount = 0;
    packages.forEach((pkg) => {
      const exists = items.some(
        (item) => item.type === type && item.name === pkg.name && item.version === pkg.version
      );
      if (!exists) {
        addItem({
          type,
          name: pkg.name,
          version: pkg.version,
        });
        addedCount++;
      }
    });

    if (addedCount > 0) {
      message.success(`${addedCount}개 패키지가 추가되었습니다`);
    } else {
      message.info('모든 패키지가 이미 장바구니에 있습니다');
    }
  };

  // 텍스트 입력 처리
  const handleTextInputSubmit = () => {
    if (!textInputValue.trim()) {
      message.warning('내용을 입력하세요');
      return;
    }

    let type: PackageType;
    let packages: { name: string; version: string }[] = [];

    switch (textInputType) {
      case 'requirements':
        type = 'pip';
        packages = parseRequirementsTxt(textInputValue);
        break;
      case 'pom':
        type = 'maven';
        packages = parsePomXml(textInputValue);
        break;
      case 'package':
        type = 'npm';
        packages = parsePackageJson(textInputValue);
        break;
    }

    addParsedPackages(type, packages);
    setTextInputModalOpen(false);
    setTextInputValue('');
  };

  // 다운로드 시작
  const handleStartDownload = () => {
    // 다운로드 옵션 저장 후 다운로드 페이지로 이동
    localStorage.setItem('downloadOptions', JSON.stringify({
      outputFormat,
      deliveryMethod,
      includeScript,
    }));
    setOptionsModalOpen(false);
    navigate('/download');
  };

  // 테이블 컬럼
  const columns = [
    {
      title: '타입',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      filters: Object.keys(typeColors).map((type) => ({
        text: type.toUpperCase(),
        value: type,
      })),
      onFilter: (value: unknown, record: CartItem) => record.type === value,
      render: (type: PackageType) => (
        <Tag color={typeColors[type]}>{type.toUpperCase()}</Tag>
      ),
    },
    {
      title: '패키지명',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: CartItem, b: CartItem) => a.name.localeCompare(b.name),
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '버전',
      dataIndex: 'version',
      key: 'version',
      width: 120,
      render: (version: string) => <Tag>{version}</Tag>,
    },
    {
      title: '아키텍처',
      dataIndex: 'arch',
      key: 'arch',
      width: 100,
      render: (arch: string | undefined) => (arch ? <Tag>{arch}</Tag> : '-'),
    },
    {
      title: '예상 크기',
      key: 'estimatedSize',
      width: 100,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">
          ~{formatSize(estimatedSizePerPackage[record.type] || 2)}
        </Text>
      ),
    },
    {
      title: '액션',
      key: 'action',
      width: 80,
      render: (_: unknown, record: CartItem) => (
        <Popconfirm
          title="정말 삭제하시겠습니까?"
          onConfirm={() => removeItem(record.id)}
          okText="삭제"
          cancelText="취소"
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  // 텍스트 입력 탭 내용
  const textInputTabs = [
    {
      key: 'requirements',
      label: 'requirements.txt',
      children: (
        <div>
          <Paragraph type="secondary">
            Python 패키지 목록을 붙여넣으세요. 한 줄에 하나의 패키지를 입력합니다.
          </Paragraph>
          <TextArea
            rows={10}
            placeholder={`requests==2.28.0
numpy>=1.21.0
pandas
flask~=2.0.0`}
            value={textInputType === 'requirements' ? textInputValue : ''}
            onChange={(e) => {
              setTextInputType('requirements');
              setTextInputValue(e.target.value);
            }}
          />
        </div>
      ),
    },
    {
      key: 'pom',
      label: 'pom.xml',
      children: (
        <div>
          <Paragraph type="secondary">
            Maven pom.xml의 &lt;dependencies&gt; 섹션을 붙여넣으세요.
          </Paragraph>
          <TextArea
            rows={10}
            placeholder={`<dependency>
  <groupId>org.springframework</groupId>
  <artifactId>spring-core</artifactId>
  <version>5.3.0</version>
</dependency>`}
            value={textInputType === 'pom' ? textInputValue : ''}
            onChange={(e) => {
              setTextInputType('pom');
              setTextInputValue(e.target.value);
            }}
          />
        </div>
      ),
    },
    {
      key: 'package',
      label: 'package.json',
      children: (
        <div>
          <Paragraph type="secondary">
            package.json 전체 또는 dependencies 부분을 붙여넣으세요.
          </Paragraph>
          <TextArea
            rows={10}
            placeholder={`{
  "dependencies": {
    "react": "^18.0.0",
    "axios": "^1.0.0"
  }
}`}
            value={textInputType === 'package' ? textInputValue : ''}
            onChange={(e) => {
              setTextInputType('package');
              setTextInputValue(e.target.value);
            }}
          />
        </div>
      ),
    },
  ];

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
          장바구니
        </Title>
        <Space>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setTextInputModalOpen(true)}
          >
            텍스트로 추가
          </Button>
          <Upload
            accept=".txt,.xml,.json"
            showUploadList={false}
            beforeUpload={handleFileUpload}
          >
            <Button icon={<UploadOutlined />}>파일 가져오기</Button>
          </Upload>
          <Button
            icon={<SearchOutlined />}
            onClick={() => navigate('/wizard')}
          >
            패키지 검색
          </Button>
          {items.length > 0 && (
            <>
              <Button
                icon={<NodeIndexOutlined />}
                onClick={handleShowDependencyTree}
                loading={loadingDeps}
              >
                의존성 트리 보기
              </Button>
              <Popconfirm
                title="모든 항목을 삭제하시겠습니까?"
                onConfirm={clearCart}
                okText="삭제"
                cancelText="취소"
              >
                <Button danger icon={<ClearOutlined />}>
                  전체 삭제
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>

      {items.length > 0 ? (
        <>
          <Table
            columns={columns}
            dataSource={items}
            rowKey="id"
            pagination={items.length > 10 ? { pageSize: 10 } : false}
            style={{ marginBottom: 24 }}
            size="middle"
          />

          {/* 요약 및 다운로드 옵션 */}
          <Card>
            <Row gutter={24} align="middle">
              <Col span={6}>
                <Statistic title="총 패키지 수" value={items.length} suffix="개" />
              </Col>
              <Col span={6}>
                <Statistic
                  title="예상 다운로드 크기"
                  value={formatSize(estimatedSize)}
                  prefix={<InfoCircleOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="예상 소요 시간"
                  value={Math.ceil(estimatedSize / 10)}
                  suffix="분"
                />
              </Col>
              <Col span={6} style={{ textAlign: 'right' }}>
                <Space>
                  <Button
                    icon={<SettingOutlined />}
                    onClick={() => setOptionsModalOpen(true)}
                  >
                    다운로드 옵션
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    icon={<DownloadOutlined />}
                    onClick={() => setOptionsModalOpen(true)}
                  >
                    다운로드 시작
                  </Button>
                </Space>
              </Col>
            </Row>

            {estimatedSize > 25 && (
              <Alert
                message="파일 크기 경고"
                description={`예상 다운로드 크기가 ${formatSize(estimatedSize)}입니다. 메일 첨부 시 용량 제한을 확인하세요. 파일 분할 옵션을 고려해 주세요.`}
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
              />
            )}
          </Card>
        </>
      ) : (
        <Card>
          <div style={{ padding: '48px 0' }}>
            <Dragger {...draggerProps} style={{ marginBottom: 24 }}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">
                패키지 파일을 드래그하여 놓거나 클릭하여 업로드하세요
              </p>
              <p className="ant-upload-hint">
                requirements.txt, pom.xml, package.json 파일 지원
              </p>
            </Dragger>

            <Empty
              description="장바구니가 비어있습니다"
              style={{ marginTop: 24 }}
            >
              <Space direction="vertical" size="middle">
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={() => navigate('/wizard')}
                >
                  패키지 검색하기
                </Button>
                <Button
                  icon={<FileTextOutlined />}
                  onClick={() => setTextInputModalOpen(true)}
                >
                  텍스트로 추가하기
                </Button>
              </Space>
            </Empty>
          </div>
        </Card>
      )}

      {/* 텍스트 입력 모달 */}
      <Modal
        title="패키지 목록 붙여넣기"
        open={textInputModalOpen}
        onCancel={() => {
          setTextInputModalOpen(false);
          setTextInputValue('');
        }}
        onOk={handleTextInputSubmit}
        okText="추가"
        cancelText="취소"
        width={600}
      >
        <Tabs
          items={textInputTabs}
          activeKey={textInputType}
          onChange={(key) => {
            setTextInputType(key as 'requirements' | 'pom' | 'package');
            setTextInputValue('');
          }}
        />
      </Modal>

      {/* 다운로드 옵션 모달 */}
      <Modal
        title="다운로드 옵션 설정"
        open={optionsModalOpen}
        onCancel={() => setOptionsModalOpen(false)}
        onOk={handleStartDownload}
        okText="다운로드 시작"
        cancelText="취소"
        width={500}
      >
        <div style={{ marginBottom: 24 }}>
          <Text strong>출력 형식</Text>
          <Radio.Group
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value)}
            style={{ display: 'block', marginTop: 8 }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {outputFormatOptions.map((opt) => (
                <Radio key={opt.value} value={opt.value}>
                  <span style={{ fontWeight: 500 }}>{opt.label}</span>
                  <span style={{ color: '#888', marginLeft: 8 }}>{opt.description}</span>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        <Divider />

        <div style={{ marginBottom: 24 }}>
          <Text strong>전달 방식</Text>
          <Radio.Group
            value={deliveryMethod}
            onChange={(e) => setDeliveryMethod(e.target.value)}
            style={{ display: 'block', marginTop: 8 }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {deliveryMethodOptions.map((opt) => (
                <Radio key={opt.value} value={opt.value}>
                  <span style={{ fontWeight: 500 }}>{opt.label}</span>
                  <span style={{ color: '#888', marginLeft: 8 }}>{opt.description}</span>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        <Divider />

        <div>
          <Text strong>추가 옵션</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={includeScript}
              onChange={(e) => setIncludeScript(e.target.value)}
            >
              <Radio value={true}>설치 스크립트 포함</Radio>
              <Radio value={false}>패키지만 다운로드</Radio>
            </Radio.Group>
          </div>
        </div>

        <Alert
          message={`총 ${items.length}개 패키지, 예상 ${formatSize(estimatedSize)}`}
          type="info"
          showIcon
          style={{ marginTop: 24 }}
        />
      </Modal>

      {/* 의존성 트리 모달 */}
      <Modal
        title="의존성 트리 미리보기"
        open={dependencyTreeModalOpen}
        onCancel={() => {
          setDependencyTreeModalOpen(false);
          setDependencyData(null);
        }}
        footer={[
          <Button key="close" onClick={() => {
            setDependencyTreeModalOpen(false);
            setDependencyData(null);
          }}>
            닫기
          </Button>,
        ]}
        width={900}
        centered
      >
        {loadingDeps ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
            <Spin size="large" tip="의존성 분석 중..." />
          </div>
        ) : (
          <DependencyTree data={dependencyData} />
        )}
      </Modal>
    </div>
  );
};

export default CartPage;
