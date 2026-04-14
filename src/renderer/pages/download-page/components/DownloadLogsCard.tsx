import { Card, Space, Tag, Typography } from 'antd';
import { logIcons } from '../presentation';
import type { LogEntry } from '../../../stores/download-store';

const { Text } = Typography;

interface DownloadLogsCardProps {
  logs: LogEntry[];
  style?: React.CSSProperties;
}

export function DownloadLogsCard({ logs, style }: DownloadLogsCardProps) {
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
          <Text type="secondary" style={{ color: '#666' }}>로그가 없습니다</Text>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ flexShrink: 0 }}>{logIcons[log.level]}</span>
              <Text style={{ color: '#888', flexShrink: 0, minWidth: 70 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </Text>
              <Text style={{ color: log.level === 'error' ? '#ff4d4f' : log.level === 'warn' ? '#faad14' : '#d9d9d9' }}>
                {log.message}
                {log.details && <span style={{ color: '#888' }}> - {log.details}</span>}
              </Text>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
