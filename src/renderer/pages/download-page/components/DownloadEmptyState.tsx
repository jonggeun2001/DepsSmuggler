import { ShoppingCartOutlined } from '@ant-design/icons';
import { Button, Card, Empty } from 'antd';

interface DownloadEmptyStateProps {
  onGoToCart: () => void;
}

export function DownloadEmptyState({ onGoToCart }: DownloadEmptyStateProps) {
  return (
    <Card>
      <Empty description="다운로드할 패키지가 없습니다">
        <Button
          type="primary"
          icon={<ShoppingCartOutlined />}
          onClick={onGoToCart}
        >
          장바구니로 이동
        </Button>
      </Empty>
    </Card>
  );
}
