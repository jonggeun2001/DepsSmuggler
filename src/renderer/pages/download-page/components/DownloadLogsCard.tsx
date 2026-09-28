import { Card, Pagination, Space, Tag, Typography } from 'antd';
import { memo, useEffect, useState } from 'react';
import { logIcons } from '../presentation';
import type { LogEntry } from '../../../stores/download-store';

const { Text } = Typography;
const PAGE_SIZE = 50;

interface DownloadLogsCardProps {
  logs: LogEntry[];
  style?: React.CSSProperties;
}

const LogRow = memo(function LogRow({ log }: { log: LogEntry }) {
  return (
    <div
      data-log-id={log.id}
      style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}
    >
      <span style={{ flexShrink: 0 }}>{logIcons[log.level]}</span>
      <Text style={{ color: '#888', flexShrink: 0, minWidth: 70 }}>
        {new Date(log.timestamp).toLocaleTimeString()}
      </Text>
      <Text
        style={{
          color: log.level === 'error' ? '#ff4d4f' : log.level === 'warn' ? '#faad14' : '#d9d9d9',
          overflowWrap: 'anywhere',
        }}
      >
        {log.message}
        {log.details && <span style={{ color: '#888' }}> - {log.details}</span>}
      </Text>
    </div>
  );
});

// Callers keep style identity stable so byte-progress updates do not revisit the log view.
export const DownloadLogsCard = memo(function DownloadLogsCard({
  logs,
  style,
}: DownloadLogsCardProps) {
  const [page, setPage] = useState(1);
  const maxPage = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const currentPage = Math.min(page, maxPage);
  useEffect(() => {
    setPage((value) => Math.min(value, maxPage));
  }, [maxPage]);
  const visibleLogs = logs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <Card
      size="small"
      title={
        <Space>
          <span>로그</span>
          <Tag>{logs.length}개</Tag>
        </Space>
      }
      style={style}
      styles={{ body: { padding: 0 } }}
    >
      <div
        aria-label="다운로드 로그"
        style={{
          height: 200,
          overflow: 'auto',
          backgroundColor: '#1a1a1a',
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        {logs.length === 0 ? (
          <Text type="secondary" style={{ color: '#666' }}>
            로그가 없습니다
          </Text>
        ) : (
          visibleLogs.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
      <nav aria-label="로그 페이지" style={{ padding: '8px 12px' }}>
        <Pagination
          current={currentPage}
          pageSize={PAGE_SIZE}
          total={logs.length}
          onChange={setPage}
          showSizeChanger={false}
          hideOnSinglePage
          showTotal={(total, range) => `${range[0]}–${range[1]} / ${total}개`}
        />
      </nav>
    </Card>
  );
});
