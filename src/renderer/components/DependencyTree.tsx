import React, { useState, useRef, useCallback, useMemo } from 'react';
import Tree, { RawNodeDatum, CustomNodeElementProps } from 'react-d3-tree';
import { Card, Typography, Tag, Space, Button, Tooltip, Modal, Descriptions, Empty } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  DownloadOutlined,
  NodeIndexOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { toPng, toSvg } from 'html-to-image';
import { DependencyNode, DependencyResolutionResult, PackageType } from '../../types';

const { Text, Title } = Typography;

interface DependencyTreeProps {
  data: DependencyResolutionResult | null;
  onNodeClick?: (node: DependencyNode) => void;
  style?: React.CSSProperties;
}

interface TreeNodeDatum extends RawNodeDatum {
  name: string;
  attributes?: {
    version: string;
    type: PackageType;
    optional?: boolean;
    scope?: string;
    size?: string;
  };
  children?: TreeNodeDatum[];
  originalNode: DependencyNode;
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
  const [selectedNode, setSelectedNode] = useState<DependencyNode | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // DependencyNode를 react-d3-tree 형식으로 변환
  const convertToTreeData = useCallback((node: DependencyNode): TreeNodeDatum => {
    return {
      name: node.package.name,
      attributes: {
        version: node.package.version,
        type: node.package.type,
        optional: node.optional,
        scope: node.scope,
        size: node.package.metadata?.size
          ? formatBytes(node.package.metadata.size)
          : undefined,
      },
      children: node.dependencies.map(convertToTreeData),
      originalNode: node,
    };
  }, []);

  const treeData = useMemo(() => {
    if (!data?.root) return null;
    return convertToTreeData(data.root);
  }, [data, convertToTreeData]);

  // 바이트 포맷
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 노드 클릭 핸들러
  const handleNodeClick = useCallback((nodeData: TreeNodeDatum) => {
    setSelectedNode(nodeData.originalNode);
    setDetailModalOpen(true);
    onNodeClick?.(nodeData.originalNode);
  }, [onNodeClick]);

  // 줌 컨트롤
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 0.3));
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
  const renderCustomNode = ({ nodeDatum }: CustomNodeElementProps) => {
    const datum = nodeDatum as unknown as TreeNodeDatum;
    const pkgType = datum.attributes?.type as PackageType;
    const color = typeColors[pkgType] || '#666';
    const isOptional = datum.attributes?.optional;

    return (
      <g onClick={() => handleNodeClick(datum)} style={{ cursor: 'pointer' }}>
        <rect
          width={140}
          height={50}
          x={-70}
          y={-25}
          rx={6}
          fill={isOptional ? '#fafafa' : '#fff'}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={isOptional ? '5,5' : 'none'}
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
        <text
          fill="#666"
          x={0}
          y={12}
          textAnchor="middle"
          style={{ fontSize: '10px' }}
        >
          {datum.attributes?.version}
        </text>
        {datum.attributes?.size && (
          <text
            fill="#999"
            x={60}
            y={-15}
            textAnchor="end"
            style={{ fontSize: '9px' }}
          >
            {datum.attributes.size}
          </text>
        )}
      </g>
    );
  };

  // 순환 의존성 감지
  const circularDeps = useMemo(() => {
    if (!data?.conflicts) return [];
    return data.conflicts.filter(c => c.type === 'circular');
  }, [data]);

  if (!data || !treeData) {
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
          {data.totalSize && (
            <Tag color="green">{formatBytes(data.totalSize)}</Tag>
          )}
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
          <Tooltip title="PNG로 저장">
            <Button
              icon={<DownloadOutlined />}
              onClick={exportToPng}
              size="small"
            >
              PNG
            </Button>
          </Tooltip>
          <Tooltip title="SVG로 저장">
            <Button
              icon={<DownloadOutlined />}
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
      <div
        ref={treeContainerRef}
        style={{
          width: '100%',
          height: 500,
          background: '#fafafa',
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
      </div>

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
            {selectedNode.package.arch && (
              <Descriptions.Item label="아키텍처">
                {selectedNode.package.arch}
              </Descriptions.Item>
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
