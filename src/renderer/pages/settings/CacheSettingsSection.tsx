import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, Popconfirm, Row, Space, Spin, Switch, Typography } from 'antd';
import React from 'react';
import type { CacheDetailItem } from './cache-stats-utils';
import {
  SETTINGS_CARD_BODY_PADDING,
  SETTINGS_CARD_MARGIN,
} from './settings-form-utils';

const { Text } = Typography;

interface CacheSettingsSectionProps {
  cacheCount: number;
  cacheDetails: CacheDetailItem[];
  cacheSize: number;
  clearingCache: boolean;
  formatBytes: (bytes: number) => string;
  loadingCache: boolean;
  onClearCache: () => Promise<void>;
  onRefreshCacheInfo: () => Promise<void>;
  onSelectCacheFolder: () => Promise<void>;
}

export const CacheSettingsSection: React.FC<CacheSettingsSectionProps> = ({
  cacheCount,
  cacheDetails,
  cacheSize,
  clearingCache,
  formatBytes,
  loadingCache,
  onClearCache,
  onRefreshCacheInfo,
  onSelectCacheFolder,
}) => {
  return (
    <Card
      title="패키지 캐시 설정"
      size="small"
      style={{ marginBottom: SETTINGS_CARD_MARGIN }}
      styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
    >
      <Row gutter={16}>
        <Col span={8}>
          <Form.Item
            name="enableCache"
            label="패키지 캐시 사용"
            valuePropName="checked"
            style={{ marginBottom: 8 }}
          >
            <Switch size="small" />
          </Form.Item>
        </Col>
        <Col span={16}>
          <Form.Item
            name="cachePath"
            label="패키지 캐시 경로"
            style={{ marginBottom: 8 }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input size="small" placeholder="~/.depssmuggler/cache" />
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => void onSelectCacheFolder()}
              />
            </Space.Compact>
          </Form.Item>
        </Col>
      </Row>

      <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
        <Spin spinning={loadingCache}>
          <Row gutter={16} align="middle">
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                디스크 크기:{' '}
              </Text>
              <Text strong style={{ fontSize: 13 }}>
                {formatBytes(cacheSize)}
              </Text>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                캐시 항목:{' '}
              </Text>
              <Text strong style={{ fontSize: 13 }}>
                {cacheCount}개
              </Text>
            </Col>
            <Col span={8} style={{ textAlign: 'right' }}>
              <Space size={4}>
                <Button
                  size="small"
                  onClick={() => void onRefreshCacheInfo()}
                  loading={loadingCache}
                >
                  새로고침
                </Button>
                <Popconfirm
                  title="패키지 캐시 삭제"
                  description="패키지 메타데이터 캐시만 삭제됩니다. 버전 목록 캐시는 유지됩니다"
                  onConfirm={() => void onClearCache()}
                  okText="삭제"
                  cancelText="취소"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    size="small"
                    danger
                    aria-label="패키지 캐시 삭제"
                    icon={<DeleteOutlined />}
                    loading={clearingCache}
                    disabled={cacheSize === 0 && cacheCount === 0}
                  />
                </Popconfirm>
              </Space>
            </Col>
          </Row>
        </Spin>
        <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
          {cacheDetails.map((detail) => (
            <Col key={detail.key} xs={24} sm={12} md={6}>
              <div
                data-testid={`cache-detail-${detail.key}`}
                style={{
                  background: '#ffffff',
                  border: '1px solid #d9d9d9',
                  borderRadius: 6,
                  padding: '10px 12px',
                  minHeight: 88,
                }}
              >
                <Text strong style={{ display: 'block', fontSize: 12 }}>
                  {detail.label}
                </Text>
                <Text style={{ display: 'block', marginTop: 4, fontSize: 16 }}>
                  {detail.entryCount}개
                </Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                  {detail.sizeBytes === undefined ? '메모리 캐시' : formatBytes(detail.sizeBytes)}
                </Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
                  {detail.description}
                </Text>
              </div>
            </Col>
          ))}
        </Row>
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          이 영역은 패키지 메타데이터 캐시만 집계합니다. 크기는 디스크 기준이며, 캐시 항목
          수에는 메모리 기반 npm 캐시도 포함될 수 있습니다. Python 버전 목록은
          localStorage, CUDA/Java/Node 버전 파일은 같은 cache 루트의 별도
          `*-versions.json` 파일로 관리됩니다.
        </Text>
      </div>
    </Card>
  );
};
