import { Alert, Button, Card, Space } from 'antd';

interface DownloadOSReselectionStateProps {
  onGoToWizard: () => void;
  onClearCart: () => void;
}

export function DownloadOSReselectionState({
  onGoToWizard,
  onClearCart,
}: DownloadOSReselectionStateProps) {
  return (
    <Card>
      <Alert
        type="warning"
        showIcon
        message="기존 OS 장바구니는 다시 선택이 필요합니다"
        description="이 장바구니 항목에는 배포판/아키텍처 스냅샷이 없어 전용 OS 다운로드를 안전하게 재개할 수 없습니다. Wizard에서 같은 배포판과 아키텍처로 패키지를 다시 담아 주세요."
        style={{ marginBottom: 16 }}
      />
      <Space>
        <Button type="primary" onClick={onGoToWizard}>
          Wizard로 이동
        </Button>
        <Button onClick={onClearCart}>
          장바구니 비우기
        </Button>
      </Space>
    </Card>
  );
}
