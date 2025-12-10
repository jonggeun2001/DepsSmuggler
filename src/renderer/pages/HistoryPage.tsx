import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  message,
  Modal,
  Descriptions,
  Statistic,
  Row,
  Col,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  ClearOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useHistoryStore, DownloadHistory, HistoryStatus } from '../stores/historyStore';
import { useCartStore, PackageType } from '../stores/cartStore';
import { useSettingsStore } from '../stores/settingsStore';

const { Title, Text } = Typography;

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

// 상태별 색상 및 아이콘
const statusConfig: Record<HistoryStatus, { color: string; icon: React.ReactNode; label: string }> = {
  success: { color: 'green', icon: <CheckCircleOutlined />, label: '성공' },
  partial: { color: 'gold', icon: <WarningOutlined />, label: '부분 성공' },
  failed: { color: 'red', icon: <CloseCircleOutlined />, label: '실패' },
};

// 파일 크기 포맷
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

// 날짜 포맷
const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { histories, deleteHistory, clearAll } = useHistoryStore();
  const { addItem } = useCartStore();
  const { updateSettings } = useSettingsStore();

  // 로컬 상태
  const [loading, setLoading] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<DownloadHistory | null>(null);

  // Electron에서 히스토리 로드 (동기화)
  const loadHistoryFromFile = useCallback(async () => {
    if (window.electronAPI?.history?.load) {
      setLoading(true);
      try {
        const fileHistories = await window.electronAPI.history.load();
        // 파일 기반 히스토리를 사용하는 경우 store와 동기화 가능
        // 현재는 Zustand persist를 주로 사용
      } catch (error) {
        console.error('Failed to load history from file:', error);
      } finally {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadHistoryFromFile();
  }, [loadHistoryFromFile]);

  // 상세 정보 모달 열기
  const handleShowDetail = useCallback((history: DownloadHistory) => {
    setSelectedHistory(history);
    setDetailModalOpen(true);
  }, []);

  // 재다운로드
  const handleRedownload = useCallback((history: DownloadHistory) => {
    Modal.confirm({
      title: '재다운로드',
      content: `${history.packages.length}개 패키지를 장바구니에 추가하고 다운로드 페이지로 이동하시겠습니까?`,
      okText: '확인',
      cancelText: '취소',
      onOk: () => {
        // 장바구니에 패키지 추가
        history.packages.forEach((pkg) => {
          addItem({
            type: pkg.type,
            name: pkg.name,
            version: pkg.version,
            arch: pkg.arch,
            languageVersion: pkg.languageVersion,
            metadata: pkg.metadata,
          });
        });

        // 설정 복원
        updateSettings({
          defaultOutputFormat: history.settings.outputFormat,
          includeInstallScripts: history.settings.includeScripts,
          includeDependencies: history.settings.includeDependencies,
        });

        message.success(`${history.packages.length}개 패키지가 장바구니에 추가되었습니다.`);
        navigate('/download');
      },
    });
  }, [addItem, updateSettings, navigate]);

  // 히스토리 삭제
  const handleDelete = useCallback(async (id: string) => {
    deleteHistory(id);

    // 파일에도 반영 (Electron 환경)
    if (window.electronAPI?.history?.delete) {
      try {
        await window.electronAPI.history.delete(id);
      } catch (error) {
        console.error('Failed to delete from file:', error);
      }
    }

    message.success('히스토리가 삭제되었습니다.');
  }, [deleteHistory]);

  // 전체 삭제
  const handleClearAll = useCallback(async () => {
    clearAll();

    // 파일에도 반영 (Electron 환경)
    if (window.electronAPI?.history?.clear) {
      try {
        await window.electronAPI.history.clear();
      } catch (error) {
        console.error('Failed to clear file:', error);
      }
    }

    message.success('모든 히스토리가 삭제되었습니다.');
  }, [clearAll]);

  // 폴더 열기
  const handleOpenFolder = useCallback(async (outputPath: string) => {
    if (window.electronAPI?.openFolder) {
      try {
        await window.electronAPI.openFolder(outputPath);
      } catch (error) {
        message.error('폴더를 열 수 없습니다.');
      }
    } else {
      message.info(`경로: ${outputPath}`);
    }
  }, []);

  // 통계
  const stats = useMemo(() => {
    const total = histories.length;
    const success = histories.filter((h) => h.status === 'success').length;
    const partial = histories.filter((h) => h.status === 'partial').length;
    const failed = histories.filter((h) => h.status === 'failed').length;
    const totalSize = histories.reduce((sum, h) => sum + h.totalSize, 0);
    return { total, success, partial, failed, totalSize };
  }, [histories]);

  // 테이블 컬럼 정의
  const columns: ColumnsType<DownloadHistory> = [
    {
      title: '날짜',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (timestamp: string) => formatDate(timestamp),
      sorter: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '패키지',
      dataIndex: 'packages',
      key: 'packages',
      width: 280,
      render: (packages: DownloadHistory['packages']) => (
        <Space wrap size={[4, 4]}>
          {packages.slice(0, 3).map((pkg, idx) => (
            <Tag key={idx} color={typeColors[pkg.type]}>
              {pkg.name}@{pkg.version}
            </Tag>
          ))}
          {packages.length > 3 && (
            <Tag>+{packages.length - 3}개</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: HistoryStatus) => {
        const config = statusConfig[status];
        return (
          <Tag color={config.color} icon={config.icon}>
            {config.label}
          </Tag>
        );
      },
      filters: [
        { text: '성공', value: 'success' },
        { text: '부분 성공', value: 'partial' },
        { text: '실패', value: 'failed' },
      ],
      onFilter: (value, record) => record.status === value,
    },
    {
      title: '크기',
      dataIndex: 'totalSize',
      key: 'totalSize',
      width: 100,
      render: (size: number) => formatSize(size),
      sorter: (a, b) => a.totalSize - b.totalSize,
    },
    {
      title: '출력 형식',
      dataIndex: ['settings', 'outputFormat'],
      key: 'outputFormat',
      width: 100,
      render: (format: string) => <Tag>{format.toUpperCase()}</Tag>,
    },
    {
      title: '작업',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Tooltip title="상세 정보">
            <Button
              type="text"
              icon={<InfoCircleOutlined />}
              onClick={() => handleShowDetail(record)}
            />
          </Tooltip>
          <Tooltip title="폴더 열기">
            <Button
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={() => handleOpenFolder(record.outputPath)}
            />
          </Tooltip>
          <Tooltip title="재다운로드">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => handleRedownload(record)}
            />
          </Tooltip>
          <Popconfirm
            title="삭제 확인"
            description="이 히스토리를 삭제하시겠습니까?"
            onConfirm={() => handleDelete(record.id)}
            okText="삭제"
            cancelText="취소"
          >
            <Tooltip title="삭제">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={2} style={{ margin: 0 }}>
            <HistoryOutlined style={{ marginRight: 8 }} />
            다운로드 히스토리
          </Title>
          <Space>
            {histories.length > 0 && (
              <Popconfirm
                title="전체 삭제"
                description="모든 히스토리를 삭제하시겠습니까?"
                onConfirm={handleClearAll}
                okText="삭제"
                cancelText="취소"
              >
                <Button danger icon={<ClearOutlined />}>
                  전체 삭제
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>

        {/* 통계 카드 */}
        {histories.length > 0 && (
          <Card size="small">
            <Row gutter={24}>
              <Col span={5}>
                <Statistic title="전체" value={stats.total} suffix="건" />
              </Col>
              <Col span={5}>
                <Statistic
                  title="성공"
                  value={stats.success}
                  suffix="건"
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col span={5}>
                <Statistic
                  title="부분 성공"
                  value={stats.partial}
                  suffix="건"
                  valueStyle={{ color: '#faad14' }}
                />
              </Col>
              <Col span={5}>
                <Statistic
                  title="실패"
                  value={stats.failed}
                  suffix="건"
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Col>
              <Col span={4}>
                <Statistic title="총 용량" value={formatSize(stats.totalSize)} />
              </Col>
            </Row>
          </Card>
        )}

        {/* 히스토리 테이블 */}
        <Card>
          <Table
            columns={columns}
            dataSource={histories}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `총 ${total}건`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="다운로드 히스토리가 없습니다"
                >
                  <Button type="primary" onClick={() => navigate('/wizard')}>
                    패키지 검색하기
                  </Button>
                </Empty>
              ),
            }}
          />
        </Card>
      </Space>

      {/* 상세 정보 모달 */}
      <Modal
        title="다운로드 상세 정보"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            닫기
          </Button>,
          <Button
            key="redownload"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => {
              if (selectedHistory) {
                handleRedownload(selectedHistory);
                setDetailModalOpen(false);
              }
            }}
          >
            재다운로드
          </Button>,
        ]}
        width={700}
      >
        {selectedHistory && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="다운로드 일시" span={2}>
              {formatDate(selectedHistory.timestamp)}
            </Descriptions.Item>
            <Descriptions.Item label="상태">
              <Tag color={statusConfig[selectedHistory.status].color} icon={statusConfig[selectedHistory.status].icon}>
                {statusConfig[selectedHistory.status].label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="총 크기">
              {formatSize(selectedHistory.totalSize)}
            </Descriptions.Item>
            <Descriptions.Item label="출력 형식">
              {selectedHistory.settings.outputFormat.toUpperCase()}
            </Descriptions.Item>
            <Descriptions.Item label="설치 스크립트">
              {selectedHistory.settings.includeScripts ? '포함' : '미포함'}
            </Descriptions.Item>
            <Descriptions.Item label="의존성 포함">
              {selectedHistory.settings.includeDependencies ? '예' : '아니오'}
            </Descriptions.Item>
            <Descriptions.Item label="출력 경로" span={2}>
              <Text copyable style={{ wordBreak: 'break-all' }}>
                {selectedHistory.outputPath}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="패키지 목록" span={2}>
              <Space wrap size={[4, 8]}>
                {selectedHistory.packages.map((pkg, idx) => (
                  <Tag key={idx} color={typeColors[pkg.type]}>
                    {pkg.name}@{pkg.version}
                    {pkg.arch && ` (${pkg.arch})`}
                  </Tag>
                ))}
              </Space>
            </Descriptions.Item>
            {selectedHistory.downloadedCount !== undefined && (
              <Descriptions.Item label="다운로드 성공">
                {selectedHistory.downloadedCount}개
              </Descriptions.Item>
            )}
            {selectedHistory.failedCount !== undefined && (
              <Descriptions.Item label="다운로드 실패">
                {selectedHistory.failedCount}개
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default HistoryPage;
