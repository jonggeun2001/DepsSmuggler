import { BranchesOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Collapse, List, Pagination, Progress, Space, Tag, Typography } from 'antd';
import { memo, useEffect, useState } from 'react';
import { statusColors, statusIcons, statusLabels } from '../presentation';
import { formatBytes, groupDownloadItems } from '../utils';
import type { DownloadStoreItem } from '../../../stores/download-store';

const { Panel } = Collapse;
const { Text } = Typography;
const PAGE_SIZE = 10;

const DependencyRow = memo(function DependencyRow({
  dep,
  onRetry,
}: {
  dep: DownloadStoreItem;
  onRetry: (item: DownloadStoreItem) => void;
}) {
  return (
    <List.Item
      data-download-item-id={dep.id}
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
            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => onRetry(dep)}>
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
  );
});

export function DownloadDependencyGroups({
  groups,
  onRetry,
}: {
  groups: ReturnType<typeof groupDownloadItems>;
  onRetry: (item: DownloadStoreItem) => void;
}) {
  const [page, setPage] = useState(1);
  const [openGroups, setOpenGroups] = useState(() => groups.map(({ parent }) => parent.id));
  const [dependencyPages, setDependencyPages] = useState<Record<string, number>>({});
  const maxPage = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const currentPage = Math.min(page, maxPage);
  useEffect(() => {
    setPage((value) => Math.min(value, maxPage));
  }, [maxPage]);
  const visibleGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <>
      <Collapse
        bordered={false}
        expandIcon={({ isActive }) => (
          <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: 12 }} />
        )}
        style={{ background: 'transparent' }}
        activeKey={openGroups}
        onChange={(keys) => setOpenGroups(Array.isArray(keys) ? keys : [keys])}
        destroyOnHidden
      >
        {visibleGroups.map(({ parent: pkg, dependencies: deps, status: groupStatus }) => {
          return (
            <Panel
              key={pkg.id}
              header={
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
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
                    {groupStatus.hasFailures && <Tag color="error">{groupStatus.failed} 실패</Tag>}
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
              {pkg.status === 'failed' && (
                <Space style={{ marginBottom: 8 }}>
                  <Text type="danger">{pkg.error}</Text>
                  <Button size="small" onClick={() => onRetry(pkg)} icon={<ReloadOutlined />}>
                    재시도
                  </Button>
                </Space>
              )}
              {deps.length > 0 ? (
                <section aria-label={`${pkg.name} 의존성 목록`}>
                  <List
                    size="small"
                    dataSource={deps}
                    rowKey="id"
                    pagination={
                      deps.length > PAGE_SIZE
                        ? {
                            pageSize: PAGE_SIZE,
                            current: Math.min(
                              dependencyPages[pkg.id] ?? 1,
                              Math.ceil(deps.length / PAGE_SIZE)
                            ),
                            showSizeChanger: false,
                            onChange: (page) =>
                              setDependencyPages((pages) => ({ ...pages, [pkg.id]: page })),
                          }
                        : false
                    }
                    renderItem={(dep) => <DependencyRow dep={dep} onRetry={onRetry} />}
                  />
                </section>
              ) : (
                <Text type="secondary">의존성 없음</Text>
              )}
            </Panel>
          );
        })}
      </Collapse>
      <nav aria-label="의존성 그룹 페이지">
        <Pagination
          current={currentPage}
          pageSize={PAGE_SIZE}
          total={groups.length}
          onChange={setPage}
          showSizeChanger={false}
          hideOnSinglePage
          showTotal={(total) => `패키지 그룹 ${total}개`}
        />
      </nav>
    </>
  );
}
