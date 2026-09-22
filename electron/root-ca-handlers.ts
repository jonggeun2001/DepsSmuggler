import { dialog, ipcMain } from 'electron';
import { clearRootCaCertificates, registerRootCaFile } from '../src/core/root-ca-store';
import { getRootCaStatus } from '../src/core/root-ca-trust';
import type { RootCaResult } from '../src/types/root-ca';

export function registerRootCaHandlers(): void {
  const safely = async (operation: () => Promise<boolean | void>): Promise<RootCaResult> => {
    try {
      const canceled = await operation();
      return { success: true, status: getRootCaStatus(), ...(canceled ? { canceled: true } : {}) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'CA 인증서 처리에 실패했습니다.',
      };
    }
  };
  ipcMain.handle('root-ca:get', () => safely(async () => {}));
  ipcMain.handle('root-ca:import', () =>
    safely(async () => {
      const result = await dialog.showOpenDialog({
        title: '추가 루트 CA 인증서 선택',
        properties: ['openFile'],
        filters: [{ name: 'X.509 CA 인증서 (PEM/DER)', extensions: ['pem', 'crt', 'cer'] }],
      });
      if (result.canceled || !result.filePaths[0]) return true;
      await registerRootCaFile(result.filePaths[0]);
    })
  );
  ipcMain.handle('root-ca:clear', () => safely(clearRootCaCertificates));
}
