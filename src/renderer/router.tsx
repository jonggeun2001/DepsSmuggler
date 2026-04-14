import type { RouteObject } from 'react-router-dom';
import { createHashRouter } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import HomePage from './pages/HomePage';
import WizardPage from './pages/WizardPage';
import CartPage from './pages/CartPage';
import DownloadPage from './pages/DownloadPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';

export const appRoutes: RouteObject[] = [
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
];

export function createAppRouter() {
  return createHashRouter(appRoutes);
}
