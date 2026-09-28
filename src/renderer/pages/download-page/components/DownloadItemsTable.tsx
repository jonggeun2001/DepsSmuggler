import { ReloadOutlined } from '@ant-design/icons';
import { Button, Progress, Space, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';
import { DownloadDependencyGroups } from './DownloadDependencyGroups';
import { statusColors, statusIcons, statusLabels } from '../presentation';
import { formatBytes, groupDownloadItems } from '../utils';
import type { DownloadStoreItem, DownloadStoreStatus } from '../../../stores/download-store';

const { Text } = Typography;

interface DownloadItemsTableProps {
  downloadItems: DownloadStoreItem[];
  showDependenciesTree: boolean;
  onRetry: (item: DownloadStoreItem) => void;
  paginate?: boolean;
}

export function DownloadItemsTable({
  downloadItems,
  showDependenciesTree,
  onRetry,
  paginate = false,
}: DownloadItemsTableProps) {
  const groups = useMemo(
    () => showDependenciesTree ? groupDownloadItems(downloadItems) : [],
    [downloadItems, showDependenciesTree]
  );
  const columns = useMemo(
    () => [
      {
        title: '상태',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status: DownloadStoreStatus) => (
          <Space>
            {statusIcons[status]}
            <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
          </Space>
        ),
      },
      {
        title: '패키지',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, record: DownloadStoreItem) => (
          <div>
            <div>
              <Text strong>{name}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {record.version}
              </Text>
              {record.type && (
                <Tag style={{ marginLeft: 8 }}>{record.type}</Tag>
              )}
            </div>
            {record.filename && (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                {record.filename}
              </Text>
            )}
            {record.status === 'failed' && record.error && (
              <Text type="danger" style={{ fontSize: 12 }}>
                {record.error}
              </Text>
            )}
          </div>
        ),
      },
      {
        title: '진행률',
        dataIndex: 'progress',
        key: 'progress',
        width: 200,
        render: (progress: number, record: DownloadStoreItem) => (
          <Progress
            percent={Math.round(progress)}
            size="small"
            status={
              record.status === 'failed'
                ? 'exception'
                : record.status === 'completed'
                ? 'success'
                : record.status === 'paused'
                ? 'normal'
                : 'active'
            }
          />
        ),
      },
      {
        title: '크기',
        dataIndex: 'totalBytes',
        key: 'size',
        width: 100,
        render: (totalBytes: number) => formatBytes(totalBytes),
      },
      {
        title: '액션',
        key: 'action',
        width: 100,
        render: (_: unknown, record: DownloadStoreItem) => (
          <Space>
            {record.status === 'failed' && (
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => onRetry(record)}
              >
                재시도
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [onRetry]
  );

  if (!showDependenciesTree) {
    return (
      <Table
        columns={columns}
        dataSource={downloadItems}
        rowKey="id"
        pagination={paginate && downloadItems.length > 10 ? { pageSize: 10 } : false}
        size="small"
      />
    );
  }

  return <DownloadDependencyGroups groups={groups} onRetry={onRetry} />;
}
