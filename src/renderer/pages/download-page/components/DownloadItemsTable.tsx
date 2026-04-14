import { BranchesOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Collapse, List, Progress, Space, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';
import { statusColors, statusIcons, statusLabels } from '../presentation';
import { formatBytes, getPackageDependencies, getPackageGroupStatus } from '../utils';
import type { DownloadItem, DownloadStatus } from '../../../stores/download-store';

const { Panel } = Collapse;
const { Text } = Typography;

interface DownloadItemsTableProps {
  downloadItems: DownloadItem[];
  showDependenciesTree: boolean;
  onRetry: (item: DownloadItem) => void;
  paginate?: boolean;
}

export function DownloadItemsTable({
  downloadItems,
  showDependenciesTree,
  onRetry,
  paginate = false,
}: DownloadItemsTableProps) {
  const columns = useMemo(
    () => [
      {
        title: '상태',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status: DownloadStatus) => (
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
        render: (name: string, record: DownloadItem) => (
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
        render: (progress: number, record: DownloadItem) => (
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
        render: (_: unknown, record: DownloadItem) => (
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

  const originalPackages = downloadItems.filter((item) => !item.isDependency);

  return (
    <Collapse
      bordered={false}
      expandIcon={({ isActive }) => (
        <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: 12 }} />
      )}
      style={{ background: 'transparent' }}
      defaultActiveKey={originalPackages.map((pkg) => pkg.id)}
    >
      {originalPackages.map((pkg) => {
        const deps = getPackageDependencies(downloadItems, pkg.id);
        const groupStatus = getPackageGroupStatus(downloadItems, pkg);

        return (
          <Panel
            key={pkg.id}
            header={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Space>
                    {statusIcons[pkg.status]}
                    <Text strong>{pkg.name}</Text>
                    <Text type="secondary">{pkg.version}</Text>
                    {pkg.type && <Tag>{pkg.type}</Tag>}
                    {deps.length > 0 && (
                      <Tag icon={<BranchesOutlined />} color="blue">
                        +{deps.length} 의존성
                      </Tag>
                    )}
                  </Space>
                  {pkg.filename && (
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 24 }}>
                      {pkg.filename}
                    </Text>
                  )}
                </div>
                <Space style={{ marginRight: 24 }}>
                  {groupStatus.hasFailures && (
                    <Tag color="error">{groupStatus.failed} 실패</Tag>
                  )}
                  <Tag color={groupStatus.isAllCompleted ? 'success' : 'processing'}>
                    {groupStatus.completed}/{groupStatus.total} 완료
                  </Tag>
                  <Text type="secondary" style={{ minWidth: 70, textAlign: 'right' }}>
                    {formatBytes(pkg.totalBytes)}
                  </Text>
                  <Progress
                    percent={Math.round(pkg.progress)}
                    size="small"
                    style={{ width: 100, marginBottom: 0 }}
                    status={
                      pkg.status === 'failed'
                        ? 'exception'
                        : pkg.status === 'completed'
                        ? 'success'
                        : 'active'
                    }
                  />
                </Space>
              </div>
            }
          >
            {deps.length > 0 ? (
              <List
                size="small"
                dataSource={deps}
                renderItem={(dep) => (
                  <List.Item
                    style={{ padding: '8px 12px' }}
                    extra={
                      <Space>
                        <Text type="secondary" style={{ minWidth: 70, textAlign: 'right' }}>
                          {formatBytes(dep.totalBytes)}
                        </Text>
                        <Progress
                          percent={Math.round(dep.progress)}
                          size="small"
                          style={{ width: 100, marginBottom: 0 }}
                          status={
                            dep.status === 'failed'
                              ? 'exception'
                              : dep.status === 'completed'
                              ? 'success'
                              : 'active'
                          }
                        />
                        {dep.status === 'failed' && (
                          <Button
                            type="link"
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => onRetry(dep)}
                          >
                            재시도
                          </Button>
                        )}
                      </Space>
                    }
                  >
                    <div>
                      <Space>
                        {statusIcons[dep.status]}
                        <Text>{dep.name}</Text>
                        <Text type="secondary">{dep.version}</Text>
                        <Tag color={statusColors[dep.status]} style={{ marginLeft: 4 }}>
                          {statusLabels[dep.status]}
                        </Tag>
                      </Space>
                      {dep.filename && (
                        <div style={{ marginLeft: 24, marginTop: 2 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dep.filename}
                          </Text>
                        </div>
                      )}
                      {dep.status === 'failed' && dep.error && (
                        <div style={{ marginLeft: 24, marginTop: 4 }}>
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {dep.error}
                          </Text>
                        </div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Text type="secondary">의존성 없음</Text>
            )}
          </Panel>
        );
      })}
    </Collapse>
  );
}
