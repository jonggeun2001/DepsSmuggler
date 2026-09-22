import { Alert, Button, Card, Descriptions, Empty, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { SETTINGS_CARD_BODY_PADDING, SETTINGS_CARD_MARGIN } from './settings-form-utils';
import type { RootCaResult, RootCaStatus } from '../../../types/root-ca';

export function RootCaSettingsSection() {
  const [status, setStatus] = useState<RootCaStatus>({ certificates: [], restartRequired: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const api = window.electronAPI?.rootCa;

  useEffect(() => {
    if (!api) return;
    let active = true;
    setBusy(true);
    void api
      .get()
      .then((result) => {
        if (!active) return;
        if (result.success) setStatus(result.status);
        else setError(result.error);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'CA 인증서를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function change(operation: () => Promise<RootCaResult>, successMessage: string) {
    setBusy(true);
    try {
      const result = await operation();
      if (!result.success) throw new Error(result.error);
      setStatus(result.status);
      setError('');
      if (!result.canceled) message.success(successMessage);
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : 'CA 인증서 변경에 실패했습니다.';
      setError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="추가 루트 CA 인증서"
      size="small"
      style={{ marginBottom: SETTINGS_CARD_MARGIN }}
      styles={{ body: { padding: SETTINGS_CARD_BODY_PADDING } }}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          회사에서 제공한 CA 인증서를 등록하면 패키지 검색과 다운로드에 사용합니다. PEM 또는 DER
          형식의 .pem, .crt, .cer 파일을 선택하세요. 여러 CA는 하나의 PEM 파일에 넣어 등록할 수
          있습니다.
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          등록·해제는 바로 저장되며 앱 재시작 후 적용됩니다. 새 파일을 등록하면 기존 등록을
          교체합니다. 운영체제의 인증서 저장소는 변경하지 않습니다.
        </Typography.Text>
        {!api ? (
          <Alert type="info" showIcon title="CA 등록은 데스크톱 앱에서 사용할 수 있습니다." />
        ) : null}
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {status.restartRequired ? (
          <Alert
            type="info"
            showIcon
            title="CA 설정을 적용하려면 앱을 완전히 종료한 뒤 다시 실행하세요."
          />
        ) : null}
        {status.certificates.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="등록된 추가 CA가 없습니다" />
        ) : (
          status.certificates.map((certificate) => (
            <Descriptions key={certificate.fingerprint} size="small" column={1} bordered>
              <Descriptions.Item label="인증서">{certificate.subject}</Descriptions.Item>
              <Descriptions.Item label="발급자">{certificate.issuer}</Descriptions.Item>
              <Descriptions.Item label="만료일">
                {new Date(certificate.validTo).toLocaleDateString('ko-KR')}
              </Descriptions.Item>
              <Descriptions.Item label="SHA-256 지문">
                <Typography.Text code style={{ wordBreak: 'break-all' }}>
                  {certificate.fingerprint}
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          ))
        )}
        <Space>
          <Button
            aria-label="인증서 파일 등록"
            disabled={!api || busy}
            loading={busy}
            onClick={() =>
              api && void change(api.import, 'CA 인증서가 등록되었습니다. 앱을 재시작하세요.')
            }
          >
            인증서 파일 등록
          </Button>
          <Button
            disabled={!api || busy || (!error && status.certificates.length === 0)}
            onClick={() =>
              api && void change(api.clear, '추가 CA 등록이 해제되었습니다. 앱을 재시작하세요.')
            }
          >
            등록 해제
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
