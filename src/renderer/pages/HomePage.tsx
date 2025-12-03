import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Button, Space, Statistic } from 'antd';
import {
  SearchOutlined,
  ShoppingCartOutlined,
  DownloadOutlined,
  CodeOutlined,
  CloudServerOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import { useCartStore } from '../stores/cartStore';

const { Title, Paragraph } = Typography;

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);

  const packageTypes = [
    {
      icon: <CodeOutlined style={{ fontSize: 32, color: '#1890ff' }} />,
      title: 'Python',
      description: 'pip, conda 패키지',
    },
    {
      icon: <CodeOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
      title: 'Java',
      description: 'Maven, Gradle 아티팩트',
    },
    {
      icon: <CloudServerOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
      title: 'Linux',
      description: 'YUM, APT, APK 패키지',
    },
    {
      icon: <ContainerOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
      title: 'Container',
      description: 'Docker 이미지',
    },
  ];

  return (
    <div>
      {/* Hero Section */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={2}>DepsSmuggler</Title>
        <Paragraph style={{ fontSize: 16, color: '#666' }}>
        폐쇄망에서 일하시는 형님들을 위한 라이브러리/패키지 의존성 다운로드 애플리케이션
        </Paragraph>
        <Space size="large" style={{ marginTop: 24 }}>
          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            onClick={() => navigate('/wizard')}
          >
            패키지 검색 시작
          </Button>
          <Button
            size="large"
            icon={<ShoppingCartOutlined />}
            onClick={() => navigate('/cart')}
          >
            장바구니 ({cartItems.length})
          </Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 48 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="장바구니"
              value={cartItems.length}
              suffix="개 패키지"
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="지원 패키지 매니저"
              value={8}
              suffix="종류"
              prefix={<CodeOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="컨테이너 레지스트리"
              value={5}
              suffix="개"
              prefix={<ContainerOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Package Types */}
      <Title level={4} style={{ marginBottom: 16 }}>
        지원하는 패키지 타입
      </Title>
      <Row gutter={16}>
        {packageTypes.map((type, index) => (
          <Col span={6} key={index}>
            <Card
              hoverable
              style={{ textAlign: 'center' }}
              onClick={() => navigate('/wizard')}
            >
              {type.icon}
              <Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
                {type.title}
              </Title>
              <Paragraph style={{ color: '#666', marginBottom: 0 }}>
                {type.description}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Quick Actions */}
      <Title level={4} style={{ marginTop: 48, marginBottom: 16 }}>
        빠른 시작
      </Title>
      <Row gutter={16}>
        <Col span={8}>
          <Card
            hoverable
            onClick={() => navigate('/wizard')}
          >
            <Card.Meta
              avatar={<SearchOutlined style={{ fontSize: 24 }} />}
              title="패키지 검색"
              description="패키지를 검색하고 의존성과 함께 다운로드할 패키지를 선택하세요."
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card
            hoverable
            onClick={() => navigate('/cart')}
          >
            <Card.Meta
              avatar={<ShoppingCartOutlined style={{ fontSize: 24 }} />}
              title="장바구니 확인"
              description="선택한 패키지를 확인하고 다운로드를 시작하세요."
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card
            hoverable
            onClick={() => navigate('/download')}
          >
            <Card.Meta
              avatar={<DownloadOutlined style={{ fontSize: 24 }} />}
              title="다운로드"
              description="패키지를 다운로드하고 출력 형식을 선택하세요."
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default HomePage;
