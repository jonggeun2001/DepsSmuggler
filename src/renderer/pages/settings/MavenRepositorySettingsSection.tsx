import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Space, Typography } from 'antd';
import { SETTINGS_CARD_BODY_PADDING } from './settings-form-utils';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositories } from '../../../utils/maven-repositories';
import type { CSSProperties } from 'react';

export function MavenRepositorySettingsSection({ style }: { style?: CSSProperties }) {
  return (
    <Card
      title="저장한 Maven 저장소"
      size="small"
      style={style}
      styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
    >
      <Typography.Paragraph type="secondary">
        Maven Central: {MAVEN_CENTRAL_URL}
        <br />
        패키지 추가 화면에서 선택할 공개 저장소 주소를 관리합니다. 목록에 저장한 모든 주소를 자동 조회하지 않습니다.
        아래 설정 저장 버튼을 누르면 목록에 적용됩니다.
      </Typography.Paragraph>
      <Form.List name="mavenRepositories">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...rest }) => (
              <Space key={key} align="baseline" style={{ display: 'flex' }}>
                <Form.Item
                  {...rest}
                  name={name}
                  rules={[
                    {
                      validator: async (_, value: unknown) => {
                        normalizeMavenRepositories([value]);
                      },
                    },
                  ]}
                  style={{ marginBottom: 8, minWidth: 280 }}
                >
                  <Input
                    aria-label={`Maven 저장소 URL ${name + 1}`}
                    placeholder="https://repo.example.com/repository/releases"
                  />
                </Form.Item>
                <Button
                  aria-label={`Maven 저장소 ${name + 1} 삭제`}
                  icon={<DeleteOutlined />}
                  onClick={() => remove(name)}
                />
              </Space>
            ))}
            <Button aria-label="저장소 추가" icon={<PlusOutlined />} onClick={() => add('')}>
              저장소 추가
            </Button>
          </>
        )}
      </Form.List>
    </Card>
  );
}
