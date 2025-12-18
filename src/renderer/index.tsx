import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createHashRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import MainLayout from './layouts/MainLayout';
import HomePage from './pages/HomePage';
import WizardPage from './pages/WizardPage';
import CartPage from './pages/CartPage';
import DownloadPage from './pages/DownloadPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import { UpdateNotification } from './components/UpdateNotification';
import './styles/global.css';

const router = createHashRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'wizard', element: <WizardPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'download', element: <DownloadPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <HomePage /> },
    ],
  },
]);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ConfigProvider locale={koKR}>
      <RouterProvider router={router} />
      <UpdateNotification />
    </ConfigProvider>
  </React.StrictMode>
);
