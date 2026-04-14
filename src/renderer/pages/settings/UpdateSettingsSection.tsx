import { SyncOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Row, Switch } from 'antd';
import React from 'react';
import {
  SETTINGS_CARD_BODY_PADDING,
  SETTINGS_CARD_MARGIN,
} from './settings-form-utils';

interface UpdateSettingsSectionProps {
  onCheckForUpdates: () => Promise<void>;
}

export const UpdateSettingsSection: React.FC<UpdateSettingsSectionProps> = ({
  onCheckForUpdates,
}) => {
  return (
    <Card
      title="자동 업데이트"
      size="small"
      style={{ marginBottom: SETTINGS_CARD_MARGIN }}
      styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
    >
      <Row gutter={16}>
        <Col span={8}>
          <Form.Item
            name="autoUpdate"
            label="자동 업데이트 확인"
            valuePropName="checked"
            style={{ marginBottom: 8 }}
            tooltip="앱 시작 시 새 버전을 자동으로 확인합니다"
          >
            <Switch size="small" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name="autoDownloadUpdate"
            label="자동 다운로드"
            valuePropName="checked"
            style={{ marginBottom: 8 }}
            tooltip="새 버전 발견 시 자동으로 다운로드합니다"
          >
            <Switch size="small" />
          </Form.Item>
        </Col>
        <Col span={8} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={() => void onCheckForUpdates()}
          >
            지금 확인
          </Button>
        </Col>
      </Row>
    </Card>
  );
};
