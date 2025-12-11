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
  npm: 1.5,
  yum: 10.0,
  apt: 8.0,
  apk: 4.0,
  docker: 150.0,
};

const CartPage: React.FC = () => {
  const navigate = useNavigate();
  const { items, removeItem, clearCart, addItem } = useCartStore();
  const settings = useSettingsStore();

  // 모달 상태
  const [textInputModalOpen, setTextInputModalOpen] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');
  const [textInputType, setTextInputType] = useState<'requirements' | 'pom' | 'package'>('requirements');


  // 의존성 트리 모달
  const [dependencyTreeModalOpen, setDependencyTreeModalOpen] = useState(false);
  const [dependencyData, setDependencyData] = useState<DependencyResolutionResult | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [lastDepsHash, setLastDepsHash] = useState<string>(''); // 캐싱용 해시

  // 장바구니 아이템 해시 계산 (캐싱용)
  const itemsHash = useMemo(() => {
    return items.map(i => `${i.type}:${i.name}:${i.version}:${i.arch || ''}`).sort().join('|');
  }, [items]);

  // 예상 다운로드 크기 계산
  const estimatedSize = useMemo(() => {
    return items.reduce((total, item) => {
      return total + (estimatedSizePerPackage[item.type] || 2);
    }, 0);
  }, [items]);

  // 의존성 트리 로드 함수
  const loadDependencyTree = useCallback(async (forceRefresh = false) => {
    if (items.length === 0) {
      setDependencyData(null);
      setLastDepsHash('');
      return;
    }

    // 캐시 히트: 장바구니가 변경되지 않았고 데이터가 있으면 재사용
    if (!forceRefresh && itemsHash === lastDepsHash && dependencyData) {
      console.log('의존성 트리 캐시 히트 - 재사용');
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

      const dependencyAPI = window.electronAPI?.dependency;
      if (dependencyAPI?.resolve) {
        // Electron 환경
        result = await dependencyAPI.resolve({ packages, options: resolverOptions });
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

      // 디버그: 트리 구조 확인
      console.log('의존성 트리 결과:', {
        treesCount: dependencyTrees?.length,
        trees: dependencyTrees?.map(t => ({
          rootName: t.root.package.name,
          rootDepsCount: t.root.dependencies.length,
          flatListCount: t.flatList.length,
        })),
      });

      if (dependencyTrees && dependencyTrees.length > 0) {
        if (dependencyTrees.length === 1) {
          // 단일 패키지인 경우 그대로 사용
          console.log('단일 트리 사용:', {
            rootDepsCount: dependencyTrees[0].root.dependencies.length,
            flatListCount: dependencyTrees[0].flatList.length,
          });
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

          // 디버그: 트리 노드 수 vs flatList 수 비교
          const countTreeNodes = (node: DependencyNode): number => {
            return 1 + node.dependencies.reduce((sum, dep) => sum + countTreeNodes(dep), 0);
          };
          const totalTreeNodes = mergedRoot.dependencies.reduce((sum, dep) => sum + countTreeNodes(dep), 0);
          console.log('병합된 트리:', {
            mergedRootDepsCount: mergedRoot.dependencies.length,
            totalTreeNodes,
            uniqueFlatListCount: uniqueFlatList.length,
            allFlatListCount: allFlatList.length,
          });

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
      // 캐시 해시 저장
      setLastDepsHash(itemsHash);
    } catch (error) {
      console.error('의존성 트리 로드 실패:', error);
      message.error('의존성 트리를 불러오는데 실패했습니다');
      setDependencyData(null);
      setLastDepsHash(''); // 실패 시 캐시 무효화
    } finally {
      setLoadingDeps(false);
    }
  }, [items, itemsHash, estimatedSize, settings.defaultTargetOS, dependencyData, lastDepsHash]);

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
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      await parsePackageFile(file.name, content);
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
  const parsePackageFile = async (filename: string, content: string) => {
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

    await addParsedPackages(type, packages);
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

  // 패키지 최신 버전 조회
  const fetchLatestVersion = async (type: PackageType, packageName: string): Promise<string | null> => {
    try {
      if (type === 'pip') {
        const response = await fetch(`/api/pypi/pypi/${encodeURIComponent(packageName)}/json`);
        if (response.ok) {
          const data = await response.json();
          return data.info?.version || null;
        }
      } else if (type === 'maven') {
        const response = await fetch(`/api/maven/versions?package=${encodeURIComponent(packageName)}`);
        if (response.ok) {
          const data = await response.json();
          return data.versions?.[0] || null;
        }
      } else if (type === 'npm') {
        const response = await fetch(`/api/npm/${encodeURIComponent(packageName)}`);
        if (response.ok) {
          const data = await response.json();
          return data['dist-tags']?.latest || null;
        }
      }
    } catch (error) {
      console.warn(`최신 버전 조회 실패: ${packageName}`, error);
    }
    return null;
  };

  // 파싱된 패키지 추가
  const addParsedPackages = async (type: PackageType, packages: { name: string; version: string }[]) => {
    if (packages.length === 0) {
      message.warning('파싱된 패키지가 없습니다');
      return;
    }

    // latest 버전인 패키지들의 실제 버전 조회
    const resolvedPackages = await Promise.all(
      packages.map(async (pkg) => {
        if (pkg.version === 'latest') {
          const latestVersion = await fetchLatestVersion(type, pkg.name);
          return { ...pkg, version: latestVersion || 'latest' };
        }
        return pkg;
      })
    );

    let addedCount = 0;
    resolvedPackages.forEach((pkg) => {
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
  const handleTextInputSubmit = async () => {
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

    await addParsedPackages(type, packages);
    setTextInputModalOpen(false);
    setTextInputValue('');
  };

  // 다운로드 시작
  const handleStartDownload = () => {
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
            <Row gutter={[16, 16]} align="middle">
              <Col xs={12} sm={6} md={5}>
                <Statistic title="총 패키지 수" value={items.length} suffix="개" />
              </Col>
              <Col xs={12} sm={6} md={5}>
                <Statistic
                  title="예상 다운로드 크기"
                  value={formatSize(estimatedSize)}
                  prefix={<InfoCircleOutlined />}
                />
              </Col>
              <Col xs={12} sm={6} md={5}>
                <Statistic
                  title="예상 소요 시간"
                  value={Math.ceil(estimatedSize / 10)}
                  suffix="분"
                />
              </Col>
              <Col xs={24} sm={24} md={9} style={{ textAlign: 'right' }}>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleStartDownload}
                >
                  다운로드 시작
                </Button>
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


      {/* 의존성 트리 모달 */}
      <Modal
        title="의존성 트리 미리보기"
        open={dependencyTreeModalOpen}
        onCancel={() => {
          setDependencyTreeModalOpen(false);
          // 캐싱을 위해 dependencyData는 유지
        }}
        footer={[
          <Button key="close" onClick={() => {
            setDependencyTreeModalOpen(false);
            // 캐싱을 위해 dependencyData는 유지
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
