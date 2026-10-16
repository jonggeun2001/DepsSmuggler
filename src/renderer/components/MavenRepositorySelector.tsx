import { Input, Select, Space, Typography, message } from 'antd';
import { useState } from 'react';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositoryUrl } from '../../utils/maven-repositories';
import { useSettingsStore } from '../stores/settings-store';
import { MavenRepositoryTestButton } from './MavenRepositoryTestButton';

export function MavenRepositorySelector({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (repository: string) => void;
  disabled?: boolean;
}) {
  const saved = useSettingsStore((state) => state.mavenRepositories);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [url, setUrl] = useState('');
  const repositories = [...new Set([MAVEN_CENTRAL_URL, ...saved, value])];

  const addRepository = () => {
    try {
      const repository = normalizeMavenRepositoryUrl(url);
      if (repository !== MAVEN_CENTRAL_URL && !saved.includes(repository)) {
        updateSettings({ mavenRepositories: [...saved, repository] });
      }
      onChange(repository);
      setUrl('');
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Typography.Text strong>Maven 저장소</Typography.Text>
      <Select
        aria-label="Maven 저장소 선택"
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{ width: '100%' }}
        options={repositories.map((repository) => ({
          value: repository,
          label: repository === MAVEN_CENTRAL_URL ? 'Maven Central (기본)' : repository,
        }))}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Input.Search
          aria-label="추가할 Maven 저장소 URL"
          placeholder="https://repo.example.com/repository/releases"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onSearch={addRepository}
          enterButton="추가·선택"
          disabled={disabled}
          style={{ flex: 1, minWidth: 0 }}
        />
        <MavenRepositoryTestButton url={url || value} disabled={disabled} />
      </div>
      <Typography.Text type="secondary">
        이 패키지에 사용할 저장소를 선택하세요. 외부 저장소는 groupId:artifactId로 검색하며,
        다운로드와 의존성 해결은 선택한 저장소와 Maven Central만 조회합니다.
      </Typography.Text>
    </Space>
  );
}
