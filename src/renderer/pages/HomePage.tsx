import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Button, Space, Statistic, Divider } from 'antd';
import {
  SearchOutlined,
  ShoppingCartOutlined,
  CodeOutlined,
  CloudServerOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import { useCartStore, PackageType } from '../stores/cart-store';

const { Title, Paragraph } = Typography;

interface PackageManagerOption {
  type: PackageType;
  label: string;
  description: string;
  color: string;
}

interface PackageCategory {
  title: string;
  icon: React.ReactNode;
  items: PackageManagerOption[];
}

const packageCategories: PackageCategory[] = [
  {
    title: '라이브러리',
    icon: <CodeOutlined style={{ fontSize: 20 }} />,
    items: [
      { type: 'pip', label: 'pip', description: 'Python (PyPI)', color: '#3776ab' },
      { type: 'conda', label: 'conda', description: 'Python/R (Anaconda)', color: '#44a833' },
      { type: 'maven', label: 'Maven', description: 'Java 라이브러리', color: '#c71a36' },
      { type: 'npm', label: 'npm', description: 'Node.js 패키지', color: '#cb3837' },
    ],
  },
  {
    title: 'OS 패키지',
    icon: <CloudServerOutlined style={{ fontSize: 20 }} />,
    items: [
      { type: 'yum', label: 'YUM', description: 'RHEL/CentOS/Fedora', color: '#ee0000' },
      { type: 'apt', label: 'APT', description: 'Ubuntu/Debian', color: '#e95420' },
      { type: 'apk', label: 'APK', description: 'Alpine Linux', color: '#0d597f' },
    ],
  },
  {
    title: '컨테이너',
    icon: <ContainerOutlined style={{ fontSize: 20 }} />,
    items: [
      { type: 'docker', label: 'Docker', description: 'Docker Hub 이미지', color: '#2496ed' },
    ],
  },
];

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);

  const handlePackageSelect = (type: PackageType) => {
    navigate(`/wizard?type=${type}`);
  };

  return (
    <div>
      {/* Hero Section */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={2}>DepsSmuggler</Title>
        <Paragraph style={{ fontSize: 16, color: '#666' }}>
        폐쇄망용 라이브러리/패키지 의존성 다운로드 애플리케이션
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

      {/* Package Types by Category */}
      <Title level={4} style={{ marginBottom: 24 }}>
        패키지 매니저 선택
      </Title>
      {packageCategories.map((category, categoryIndex) => (
        <div key={categoryIndex} style={{ marginBottom: 32 }}>
          <Space style={{ marginBottom: 12 }}>
            {category.icon}
            <Title level={5} style={{ margin: 0 }}>{category.title}</Title>
          </Space>
          <Row gutter={[16, 16]}>
            {category.items.map((item) => (
              <Col xs={12} sm={8} md={6} key={item.type}>
                <Card
                  hoverable
                  style={{ textAlign: 'center', borderTop: `3px solid ${item.color}` }}
                  onClick={() => handlePackageSelect(item.type)}
                >
                  <Title level={5} style={{ marginBottom: 4, color: item.color }}>
                    {item.label}
                  </Title>
                  <Paragraph style={{ color: '#666', marginBottom: 0, fontSize: 12 }}>
                    {item.description}
                  </Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
          {categoryIndex < packageCategories.length - 1 && <Divider />}
        </div>
      ))}
    </div>
  );
};

export default HomePage;
