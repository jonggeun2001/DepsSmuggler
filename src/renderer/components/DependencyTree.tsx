import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  DownloadOutlined,
  NodeIndexOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Card,
  Typography,
  Tag,
  Space,
  Button,
  Tooltip,
  Modal,
  Descriptions,
  Empty,
  Collapse,
} from 'antd';
import { toPng, toSvg } from 'html-to-image';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Tree, { CustomNodeElementProps } from 'react-d3-tree';
import {
  createDisplayTree,
  indexDependencyGraph,
  INITIAL_TREE_NODE_LIMIT,
  type DisplayTreeNode,
} from './dependency-tree-model';
import { getPackageArtifactKey } from '../../core/shared/dependency-tree-utils';
import { DependencyNode, DependencyResolutionResult, PackageType } from '../../types';

const { Text } = Typography;

interface DependencyTreeProps {
  data: DependencyResolutionResult | null;
  onNodeClick?: (node: DependencyNode) => void;
  style?: React.CSSProperties;
}

const typeColors: Record<PackageType, string> = {
  pip: '#3776ab',
  conda: '#44a833',
  maven: '#c71a36',
  npm: '#cb3837',
  yum: '#ff6600',
  apt: '#a80030',
  apk: '#0d597f',
  docker: '#2496ed',
};

const DependencyTree: React.FC<DependencyTreeProps> = ({ data, onNodeClick, style }) => {
  const [zoom, setZoom] = useState(1);
  const [expandedView, setExpandedView] = useState({
    source: data,
    limit: INITIAL_TREE_NODE_LIMIT,
  });
  const visibleLimit = expandedView.source === data ? expandedView.limit : INITIAL_TREE_NODE_LIMIT;
  // The derived limit resets immediately; release the previous source graph after replacement.
  useEffect(() => {
    setExpandedView((previous) =>
      previous.source === data ? previous : { source: data, limit: INITIAL_TREE_NODE_LIMIT }
    );
  }, [data]);
  const [selectedNode, setSelectedNode] = useState<DependencyNode | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // 바이트 포맷
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const graph = useMemo(() => (data?.root ? indexDependencyGraph(data.root) : null), [data]);
  const display = useMemo(
    () => (graph ? createDisplayTree(graph, visibleLimit) : null),
    [graph, visibleLimit]
  );
  const treeData = display?.root;

  const additionalPoms = useMemo(() => {
    if (!data) return [];
    const representedArtifacts = new Set(graph?.artifacts.keys());
    return data.flatList.filter((pkg) => {
      if (pkg.type !== 'maven' || pkg.metadata?.type !== 'pom') return false;
      const key = getPackageArtifactKey(pkg);
      if (representedArtifacts.has(key)) return false;
      representedArtifacts.add(key);
      return true;
    });
  }, [data, graph]);

  // 노드 클릭 핸들러
  const handleNodeClick = useCallback(
    (node: DependencyNode) => {
      setSelectedNode(node);
      setDetailModalOpen(true);
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // 줌 컨트롤
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.2, 0.3));
  const handleResetZoom = () => setZoom(1);

  // PNG 내보내기
  const exportToPng = async () => {
    if (!treeContainerRef.current) return;
    try {
      const dataUrl = await toPng(treeContainerRef.current, {
        backgroundColor: '#fff',
        quality: 1,
      });
      const link = document.createElement('a');
      link.download = `dependency-tree-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('PNG 내보내기 실패:', error);
    }
  };

  // SVG 내보내기
  const exportToSvg = async () => {
    if (!treeContainerRef.current) return;
    try {
      const dataUrl = await toSvg(treeContainerRef.current, {
        backgroundColor: '#fff',
      });
      const link = document.createElement('a');
      link.download = `dependency-tree-${Date.now()}.svg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('SVG 내보내기 실패:', error);
    }
  };

  // 커스텀 노드 렌더러
  const renderCustomNode = useCallback(
    ({ nodeDatum }: CustomNodeElementProps) => {
      const datum = nodeDatum as unknown as DisplayTreeNode;
      const original = display?.lookup.get(datum.lookupId);
      const pkgType = datum.attributes?.type as PackageType;
      const color = typeColors[pkgType] || '#666';
      const isOptional = datum.attributes?.optional;
      const artifactLabel = [
        datum.attributes.version,
        pkgType === 'maven' ? (datum.attributes.artifactType || 'jar').toUpperCase() : undefined,
        datum.attributes.classifier,
      ]
        .filter(Boolean)
        .join(' · ');

      return (
        <g
          role="button"
          stroke="none"
          tabIndex={0}
          aria-label={`${datum.name}@${artifactLabel}${datum.reference ? ' 참조' : ''} 상세 보기`}
          onClick={() => original && handleNodeClick(original)}
          onKeyDown={(event) => {
            if (original && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              handleNodeClick(original);
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          <title>
            {[
              datum.name,
              datum.attributes.version,
              datum.attributes.artifactType,
              datum.attributes.classifier,
              datum.reference ? '참조: 하위 의존성은 처음 표시된 패키지에서 확인하세요.' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </title>
          <rect
            width={140}
            height={datum.reference ? 65 : 50}
            x={-70}
            y={-25}
            rx={6}
            fill={isOptional ? '#fafafa' : '#fff'}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={datum.reference ? '3,3' : isOptional ? '5,5' : 'none'}
          />
          <text
            fill={color}
            x={0}
            y={-5}
            textAnchor="middle"
            style={{ fontSize: '12px', fontWeight: 'bold' }}
          >
            {datum.name.length > 15 ? datum.name.slice(0, 15) + '...' : datum.name}
          </text>
          <text fill="#666" x={0} y={12} textAnchor="middle" style={{ fontSize: '10px' }}>
            {artifactLabel.length > 25 ? artifactLabel.slice(0, 22) + '...' : artifactLabel}
          </text>
          {datum.reference && (
            <text fill="#666" x={0} y={29} textAnchor="middle" style={{ fontSize: '10px' }}>
              ↗ 참조
            </text>
          )}
          {datum.attributes?.size ? (
            <text fill="#999" x={60} y={-15} textAnchor="end" style={{ fontSize: '9px' }}>
              {formatBytes(datum.attributes.size)}
            </text>
          ) : null}
        </g>
      );
    },
    [display, handleNodeClick, formatBytes]
  );

  // 순환 의존성 감지
  const circularDeps = useMemo(() => {
    if (!data?.conflicts) return [];
    return data.conflicts.filter((c) => c.type === 'circular');
  }, [data]);

  if (!data || !treeData || !display) {
    return (
      <Card style={{ ...style, minHeight: 400 }}>
        <Empty
          image={<NodeIndexOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
          description="의존성 트리 데이터가 없습니다"
        />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <NodeIndexOutlined />
          <span>의존성 트리</span>
          <Tag color="blue">{data.flatList.length}개 패키지</Tag>
          {data.totalSize && <Tag color="green">{formatBytes(data.totalSize)}</Tag>}
          {circularDeps.length > 0 && (
            <Tooltip title="순환 의존성이 감지되었습니다">
              <Tag color="red" icon={<WarningOutlined />}>
                순환 {circularDeps.length}개
              </Tag>
            </Tooltip>
          )}
        </Space>
      }
      extra={
        <Space>
          <Tooltip title="축소">
            <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} size="small" />
          </Tooltip>
          <Tooltip title="확대">
            <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} size="small" />
          </Tooltip>
          <Tooltip title="원래 크기">
            <Button icon={<FullscreenOutlined />} onClick={handleResetZoom} size="small" />
          </Tooltip>
          <Tooltip title="현재 표시 영역을 PNG로 저장 (참조 표식 포함)">
            <Button
              icon={<DownloadOutlined />}
              aria-label="PNG 저장"
              onClick={exportToPng}
              size="small"
            >
              PNG
            </Button>
          </Tooltip>
          <Tooltip title="현재 표시 영역을 SVG로 저장 (참조 표식 포함)">
            <Button
              icon={<DownloadOutlined />}
              aria-label="SVG 저장"
              onClick={exportToSvg}
              size="small"
            >
              SVG
            </Button>
          </Tooltip>
        </Space>
      }
      style={style}
      styles={{ body: { padding: 0 } }}
    >
      <Space wrap style={{ padding: '12px 16px' }}>
        <Text>
          표시 항목 {display.displayedCount}/{display.totalCount}개 · 참조 {display.referenceCount}
          개
        </Text>
        {display.hasMore && (
          <Button
            size="small"
            onClick={() =>
              setExpandedView({ source: data, limit: visibleLimit + INITIAL_TREE_NODE_LIMIT })
            }
          >
            200개 더 표시
          </Button>
        )}
        <Text type="secondary">
          같은 패키지의 하위 의존성은 한 번 펼칩니다. 참조 노드도 상세 보기가 가능합니다.
        </Text>
      </Space>
      <div
        ref={treeContainerRef}
        style={{
          width: '100%',
          height: 500,
          background: '#fafafa',
          position: 'relative',
        }}
      >
        <Tree
          data={treeData}
          orientation="vertical"
          pathFunc="step"
          translate={{ x: 400, y: 50 }}
          zoom={zoom}
          nodeSize={{ x: 180, y: 100 }}
          renderCustomNodeElement={renderCustomNode}
          separation={{ siblings: 1.5, nonSiblings: 2 }}
          enableLegacyTransitions
          transitionDuration={300}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            pointerEvents: 'none',
            fontSize: 11,
            color: '#666',
            background: 'rgba(255,255,255,0.9)',
          }}
        >
          현재 표시 영역 · 표시 항목 {display.displayedCount}/{display.totalCount}개 · ↗ 참조 노드는
          하위 항목 생략
        </div>
      </div>

      {additionalPoms.length > 0 && (
        <Collapse
          size="small"
          style={{ margin: 16 }}
          items={[
            {
              key: 'additional-poms',
              label: `함께 다운로드할 POM (${additionalPoms.length}개)`,
              children: (
                <>
                  <Text type="secondary">부모·BOM POM 파일도 함께 다운로드됩니다.</Text>
                  <ul
                    aria-label="함께 다운로드할 POM 목록"
                    style={{
                      listStyle: 'none',
                      margin: '12px 0 0',
                      padding: 0,
                      maxHeight: 260,
                      overflowY: 'auto',
                    }}
                  >
                    {additionalPoms.map((pkg) => {
                      const filename =
                        typeof pkg.metadata?.filename === 'string'
                          ? pkg.metadata.filename
                          : `${pkg.name.split(':')[1]}-${pkg.version}.pom`;
                      return (
                        <li
                          key={getPackageArtifactKey(pkg)}
                          style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
                        >
                          <Button
                            type="link"
                            aria-label={`${filename} 상세 보기`}
                            onClick={() => handleNodeClick({ package: pkg, dependencies: [] })}
                            style={{
                              padding: 0,
                              height: 'auto',
                              whiteSpace: 'normal',
                              textAlign: 'left',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {filename}
                          </Button>
                          <div>
                            <Text type="secondary">{pkg.name}</Text>
                          </div>
                          <Space size={8}>
                            <Tag>POM</Tag>
                            <Text>{pkg.version}</Text>
                          </Space>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ),
            },
          ]}
        />
      )}

      {/* 노드 상세 정보 모달 */}
      <Modal
        title={
          <Space>
            <NodeIndexOutlined />
            패키지 상세 정보
          </Space>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={500}
      >
        {selectedNode && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="패키지명">
              <Text strong>{selectedNode.package.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="버전">
              <Tag>{selectedNode.package.version}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="타입">
              <Tag color={typeColors[selectedNode.package.type]}>
                {selectedNode.package.type.toUpperCase()}
              </Tag>
            </Descriptions.Item>
            {selectedNode.package.type === 'maven' && (
              <Descriptions.Item label="파일 형식">
                <Tag>
                  {(typeof selectedNode.package.metadata?.type === 'string'
                    ? selectedNode.package.metadata.type
                    : 'jar'
                  ).toUpperCase()}
                </Tag>
              </Descriptions.Item>
            )}
            {typeof selectedNode.package.metadata?.classifier === 'string' && (
              <Descriptions.Item label="분류자 (classifier)">
                {selectedNode.package.metadata.classifier}
              </Descriptions.Item>
            )}
            {typeof selectedNode.package.metadata?.filename === 'string' && (
              <Descriptions.Item label="파일명">
                <Text style={{ overflowWrap: 'anywhere' }}>
                  {selectedNode.package.metadata.filename}
                </Text>
              </Descriptions.Item>
            )}
            {selectedNode.package.arch && (
              <Descriptions.Item label="아키텍처">{selectedNode.package.arch}</Descriptions.Item>
            )}
            {selectedNode.optional && (
              <Descriptions.Item label="선택적 의존성">
                <Tag color="orange">선택적</Tag>
              </Descriptions.Item>
            )}
            {selectedNode.scope && (
              <Descriptions.Item label="스코프">
                <Tag>{selectedNode.scope}</Tag>
              </Descriptions.Item>
            )}
            {selectedNode.package.metadata?.size && (
              <Descriptions.Item label="크기">
                {formatBytes(selectedNode.package.metadata.size)}
              </Descriptions.Item>
            )}
            {selectedNode.package.metadata?.description && (
              <Descriptions.Item label="설명">
                {selectedNode.package.metadata.description}
              </Descriptions.Item>
            )}
            {selectedNode.package.metadata?.homepage && (
              <Descriptions.Item label="홈페이지">
                <a
                  href={selectedNode.package.metadata.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedNode.package.metadata.homepage}
                </a>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="직접 의존성">
              {selectedNode.dependencies.length > 0 ? (
                <Space wrap>
                  {selectedNode.dependencies.map((dep, idx) => (
                    <Tag key={idx} color="default">
                      {dep.package.name}@{dep.package.version}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">없음</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
};

export default DependencyTree;
