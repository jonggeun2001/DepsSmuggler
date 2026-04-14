import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import { UpdateNotification } from './components/UpdateNotification';
import { createAppRouter } from './router';
import './styles/global.css';

const router = createAppRouter();

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
