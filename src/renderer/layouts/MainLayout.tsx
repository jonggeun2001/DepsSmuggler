import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Badge, Typography } from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  DownloadOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useCartStore } from '../stores/cartStore';

const { Header, Sider, Content, Footer } = Layout;
const { Title } = Typography;

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const cartItems = useCartStore((state) => state.items);

  const menuItems = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: '홈',
    },
    {
      key: '/wizard',
      icon: <SearchOutlined />,
      label: '패키지 검색',
    },
    {
      key: '/cart',
      icon: (
        <Badge count={cartItems.length} size="small" offset={[5, 0]}>
          <ShoppingCartOutlined />
        </Badge>
      ),
      label: '장바구니',
    },
    {
      key: '/download',
      icon: <DownloadOutlined />,
      label: '다운로드',
    },
    {
      key: '/history',
      icon: <HistoryOutlined />,
      label: '히스토리',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '설정',
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          height: '100vh',
          overflow: 'auto',
          zIndex: 100,
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Title
            level={4}
            style={{
              color: '#fff',
              margin: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {collapsed ? 'DS' : 'DepsSmuggler'}
          </Title>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: '#fff',
            borderRadius: 8,
            minHeight: 'calc(100vh - 70px - 48px)',
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
        <Footer style={{ textAlign: 'center', background: '#f0f2f5' }}>
          DepsSmuggler ©{new Date().getFullYear()} - MIT License
        </Footer>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
