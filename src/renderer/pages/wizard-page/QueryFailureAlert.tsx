import { Alert, Button, Space } from 'antd';
import { Link } from 'react-router-dom';
import type { QueryFailure } from '../../../types/query-error';

export function QueryFailureAlert({
  failure,
  version = false,
  loading,
  onRetry,
}: {
  failure: QueryFailure;
  version?: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <Alert
      type={version ? 'warning' : 'error'}
      showIcon
      title={version ? '버전 목록을 불러오지 못했습니다' : '패키지 검색에 실패했습니다'}
      description={
        <Space orientation="vertical">
          <span>{failure.message}</span>
          {version && (
            <span>검색 결과에 포함된 버전을 표시합니다. 최신 버전 목록은 다시 조회하세요.</span>
          )}
          <Space wrap>
            <Button size="small" onClick={onRetry} disabled={loading}>
              다시 시도
            </Button>
            {failure.code === 'TLS_CERTIFICATE' && <Link to="/settings">CA 설정 열기</Link>}
          </Space>
        </Space>
      }
      style={{ marginBottom: 16 }}
    />
  );
}
