import { Button, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { normalizeMavenRepositoryUrl } from '../../utils/maven-repositories';
import type { MavenRepositoryTestResult } from '../../types/maven-repository';

export function MavenRepositoryTestButton({
  url,
  disabled,
  label = 'Maven 저장소 연결 테스트',
}: {
  url: unknown;
  disabled?: boolean;
  label?: string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<MavenRepositoryTestResult>();
  const request = useRef(0);

  useEffect(() => {
    request.current++;
    setTesting(false);
    setResult(undefined);
    return () => {
      request.current++;
    };
  }, [url]);

  const testConnection = async () => {
    const id = ++request.current;
    setTesting(true);
    setResult(undefined);
    try {
      const repositoryUrl = normalizeMavenRepositoryUrl(url);
      const test = window.electronAPI?.maven?.testRepository;
      if (!test) throw new Error('연결 테스트는 최신 Electron 앱에서 사용할 수 있습니다.');
      const response = await test(repositoryUrl);
      if (id === request.current) setResult(response);
    } catch (error) {
      if (id === request.current) {
        setResult({
          success: false,
          message: error instanceof Error ? error.message : '연결 테스트에 실패했습니다.',
        });
      }
    } finally {
      if (id === request.current) setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <Button
        aria-label={label}
        loading={testing}
        disabled={disabled || testing}
        onClick={() => void testConnection()}
      >
        테스트
      </Button>
      {result && (
        <div role="status" aria-live="polite" style={{ marginTop: 4, fontSize: 12 }}>
          <Typography.Text type={result.success ? 'success' : 'danger'}>
            {result.message}
          </Typography.Text>
          {result.success && (
            <div>
              <Typography.Text type="secondary">
                주소의 응답을 확인했습니다. 패키지 제공 여부는 좌표 검색으로 확인하세요.
              </Typography.Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
